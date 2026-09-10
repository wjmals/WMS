import * as admin from "firebase-admin";

// Initialize Firebase Admin globally
admin.initializeApp();

// Export Delivery Functions
export * from "./delivery";

// Export Inventory Functions
export * from "./inventory";
