// Cloud Functions du domaine commandes (écritures sensibles).
import type {
  AcceptOrderInput,
  AssignOwnCourierInput,
  CancelOrderInput,
  CancelOrderResult,
  CompleteOrderInput,
  ConfirmPickupInput,
  ExtendPrepTimeInput,
  OrderIdInput,
  OrderStatus,
  RejectOrderInput,
  ReportOrderIssueInput,
  ReportOrderIssueResult,
  RequestCourierResult,
} from '@golink/shared';
import { callFunction } from '@/lib/firestore';

export const ordersApi = {
  accept: callFunction<AcceptOrderInput, { status: OrderStatus }>('acceptOrder'),
  reject: callFunction<RejectOrderInput, CancelOrderResult>('rejectOrder'),
  startPreparation: callFunction<OrderIdInput, { status: OrderStatus }>('startPreparation'),
  markReady: callFunction<OrderIdInput, { status: OrderStatus }>('markOrderReady'),
  extendPrep: callFunction<ExtendPrepTimeInput, { prepExtendedMinutes: number }>('extendPrepTime'),
  confirmPickup: callFunction<ConfirmPickupInput, { status: OrderStatus }>('confirmPickup'),
  complete: callFunction<CompleteOrderInput, { status: OrderStatus }>('completeOrder'),
  markPickedUp: callFunction<OrderIdInput, { status: OrderStatus }>('markOrderPickedUp'),
  cancel: callFunction<CancelOrderInput, CancelOrderResult>('cancelOrder'),
  requestCourier: callFunction<OrderIdInput, RequestCourierResult>('requestCourier'),
  assignOwnCourier: callFunction<AssignOwnCourierInput, { driverName: string }>('assignOwnCourier'),
  reportIssue: callFunction<ReportOrderIssueInput, ReportOrderIssueResult>('reportOrderIssue'),
};
