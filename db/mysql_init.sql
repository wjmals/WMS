-- WMS Delivery Module Database Schema

CREATE DATABASE IF NOT EXISTS wms_delivery DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wms_delivery;

-- 운송장 기본 정보 테이블
CREATE TABLE IF NOT EXISTS shipments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tracking_number VARCHAR(100) NOT NULL UNIQUE,
    courier_code VARCHAR(10),
    courier_name VARCHAR(50),
    status VARCHAR(50) DEFAULT 'UNKNOWN', -- 배송상태 (예: 집화처리, 배송중, 배송완료 등)
    sender_name VARCHAR(100),
    receiver_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_api_synced_at TIMESTAMP NULL, -- SweetTracker API 마지막 동기화 시간 (캐싱 목적)
    INDEX idx_tracking_number (tracking_number)
);

-- 운송장별 상세 배송 이력 테이블 (Tracking Info)
CREATE TABLE IF NOT EXISTS shipment_histories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shipment_id INT NOT NULL,
    time_string VARCHAR(50), -- 택배사에서 전달받은 시간 문자열
    location VARCHAR(100),
    status_detail VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);
