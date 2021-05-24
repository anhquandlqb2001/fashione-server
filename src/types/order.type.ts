export interface OrderItem {
  id: string
  product_id: string
  product_name: string
  quantity: string
  variant_id: string
  variant_option_id: string
  variant_name: string
  variant_value: string 
}

export interface OrderItemStatusFirebaseResponse {
  id: string,
  status: string
}

export interface OrderItemStatusRequest {
  status: string,
  quantity: number
}

export enum EOrderItemStatus {
  CONFIRMING,
  COLLECTING,
  DELIVERING,
  DELIVERED,
  COMPLETE
}