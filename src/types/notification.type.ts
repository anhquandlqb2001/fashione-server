import admin, { firestore } from "firebase-admin";

export interface DeviceToken {
  userId: string
  token: string
}

export enum ENotificationType {
  PROMOTION, ACTIVITY, ORDER_STATUS
}

export interface NotificationType {
  id: string,
  name: ENotificationType,
  description: string,
  image_url: string
}

export interface Notification {
  id?: string,
  type_id: string,
  recipient_id: string,
  device_id: string,
  read: boolean,
  deleted: boolean,
  created_at: firestore.FieldValue
}

export interface NotificationExtend extends Notification {
  data: {
    payload: admin.messaging.MessagingPayload
  }
}

export interface NotificationOrderStatus extends Notification {
  data: {
    product: {
      order_id: string,
      order_item_id: string
    },
    payload: admin.messaging.MessagingPayload
  }
}