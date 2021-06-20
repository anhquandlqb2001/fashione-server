export interface Sale {
  product_id: string;
  target_id: string;
  sale_type: EnumSaleType;
  discount: string;
  time: number
}

export enum EnumSaleType {
  PRODUCT_LEVEL = 1,
  VARIANT_LEVEL = 2,
  VARIANT_OPTION_LEVEL = 3
}

export interface SaleRequestData {
  sale: Sale;
}