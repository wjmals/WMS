import { onSchedule } from "firebase-functions/v2/scheduler";
import { onValueWritten } from "firebase-functions/v2/database";
import * as admin from "firebase-admin";

const db = admin.firestore();
const fcm = admin.messaging();

// 1. Demand Forecast & Auto Reorder Alert (Cron Job)
// Runs daily at midnight Asia/Seoul
export const checkInventoryDemand = onSchedule({
    schedule: "0 0 * * *",
    timeZone: "Asia/Seoul",
}, async (event) => {
    try {
        console.log("Running daily inventory demand forecast...");
        
        // 1. Fetch recent 30 days consumption history from Firestore
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const itemsSnap = await db.collection("inventory_items").get();
        
        for (const doc of itemsSnap.docs) {
            const item = doc.data();
            const itemId = doc.id;
            const leadTime = item.leadTime || 7; // Default 7 days
            
            // Fetch history
            const historySnap = await db.collection(`inventory_items/${itemId}/history`)
                .where("date", ">=", thirtyDaysAgo)
                .orderBy("date", "asc")
                .get();
                
            if (historySnap.empty) continue;
            
            let totalConsumed = 0;
            const dataPoints: {x: number, y: number}[] = [];
            let dayIndex = 1;
            
            historySnap.forEach(hDoc => {
                const hData = hDoc.data();
                totalConsumed += hData.consumed || 0;
                dataPoints.push({ x: dayIndex, y: hData.consumed || 0 });
                dayIndex++;
            });
            
            const avgConsumption = totalConsumed / 30;
            
            // Simple Linear Regression for trend
            // y = mx + b
            let n = dataPoints.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            dataPoints.forEach(p => {
                sumX += p.x;
                sumY += p.y;
                sumXY += p.x * p.y;
                sumXX += p.x * p.x;
            });
            
            const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) || 0;
            
            // Predict depletion date based on current stock
            const currentStock = item.currentStock || 0;
            const projectedDailyConsumption = Math.max(avgConsumption + m * 5, 0.1); // Avoid div by 0
            
            const daysUntilDepletion = currentStock / projectedDailyConsumption;
            const recommendedReorderDays = daysUntilDepletion - leadTime;
            
            if (recommendedReorderDays <= 3 && !item.reorderAlertSent) {
                // Send FCM
                await fcm.send({
                    topic: "admin_alerts",
                    notification: {
                        title: "재고 부족 예상 알림",
                        body: `${item.name}의 재고가 ${Math.round(daysUntilDepletion)}일 후 소진될 예상입니다. (권장 재주문 시기 도래)`
                    }
                });
                
                // Mark alert sent
                await db.collection("inventory_items").doc(itemId).update({
                    reorderAlertSent: true,
                    daysUntilDepletion: Math.round(daysUntilDepletion)
                });
            }
        }
    } catch (error) {
        console.error("checkInventoryDemand error:", error);
    }
});

// 2. Camera-based real-time stock shortage detection (RTDB Trigger)
export const onInventoryStateChange = onValueWritten({
    ref: "/inventory/camera_zones/{zoneId}"
}, async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();

    if (!after) return; // Deleted

    const oldState = before ? before.state : 'normal';
    const newState = after.state;

    // Send alert only when it newly becomes low or empty
    if ((newState === 'low' || newState === 'empty') && oldState === 'normal') {
        const zoneName = after.zoneName || event.params.zoneId;
        
        await fcm.send({
            topic: "admin_alerts",
            notification: {
                title: "실시간 재고 경고",
                body: `구역 ${zoneName}의 재고 상태가 '${newState}'로 변경되었습니다.`
            },
            data: {
                imageUrl: after.lastImageUrl || ""
            }
        });
        
        // Log to Firestore for persistence
        await db.collection("inventory_alerts").add({
            zoneId: event.params.zoneId,
            zoneName: zoneName,
            newState: newState,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            imageUrl: after.lastImageUrl || ""
        });
    }
});
