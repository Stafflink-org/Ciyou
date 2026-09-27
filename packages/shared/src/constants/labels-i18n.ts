// Traductions des libellés d'énumérations (anglais, arabe). Le français vit dans
// labels.ts (source de vérité) ; une clé absente d'une langue retombe sur le
// français, jamais sur un écran cassé. Usage : labelOf('ORDER_STATUS_LABELS', 'new', locale).
import * as fr from './labels';
import { PLATFORM_ALERT_KIND_LABELS, PLATFORM_ALERT_STATUS_LABELS } from './pilotage';
import type { Locale } from './enums';

/** Tables de libellés traduisibles : toutes les constantes *_LABELS de labels.ts. */
const FR_TABLES = {
  MERCHANT_TYPE_LABELS: fr.MERCHANT_TYPE_LABELS,
  PRODUCT_SALE_UNIT_LABELS: fr.PRODUCT_SALE_UNIT_LABELS,
  BILLING_MODE_LABELS: fr.BILLING_MODE_LABELS,
  COURIER_PAY_MODEL_LABELS: fr.COURIER_PAY_MODEL_LABELS,
  LOCALE_LABELS: fr.LOCALE_LABELS,
  ORDER_STATUS_LABELS: fr.ORDER_STATUS_LABELS,
  ORDER_STATUS_CLIENT_LABELS: fr.ORDER_STATUS_CLIENT_LABELS,
  FULFILLMENT_LABELS: fr.FULFILLMENT_LABELS,
  CANCEL_REASON_LABELS: fr.CANCEL_REASON_LABELS,
  REFUND_CAUSE_LABELS: fr.REFUND_CAUSE_LABELS,
  PAYMENT_METHOD_LABELS: fr.PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS: fr.PAYMENT_STATUS_LABELS,
  REFUND_STATUS_LABELS: fr.REFUND_STATUS_LABELS,
  PAYOUT_STATUS_LABELS: fr.PAYOUT_STATUS_LABELS,
  INVOICE_KIND_LABELS: fr.INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS: fr.INVOICE_STATUS_LABELS,
  VAT_CATEGORY_LABELS: fr.VAT_CATEGORY_LABELS,
  ACCOUNT_STATUS_LABELS: fr.ACCOUNT_STATUS_LABELS,
  ONBOARDING_STATUS_LABELS: fr.ONBOARDING_STATUS_LABELS,
  RESTAURANT_STATUS_LABELS: fr.RESTAURANT_STATUS_LABELS,
  DRIVER_STATUS_LABELS: fr.DRIVER_STATUS_LABELS,
  DRIVER_AVAILABILITY_LABELS: fr.DRIVER_AVAILABILITY_LABELS,
  DRIVER_TYPE_LABELS: fr.DRIVER_TYPE_LABELS,
  RESTAURANT_COURIER_STATUS_LABELS: fr.RESTAURANT_COURIER_STATUS_LABELS,
  VEHICLE_LABELS: fr.VEHICLE_LABELS,
  SANCTION_TYPE_LABELS: fr.SANCTION_TYPE_LABELS,
  PARTNER_DOCUMENT_LABELS: fr.PARTNER_DOCUMENT_LABELS,
  DOCUMENT_STATUS_LABELS: fr.DOCUMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS: fr.SUBSCRIPTION_STATUS_LABELS,
  PROMOTION_KIND_LABELS: fr.PROMOTION_KIND_LABELS,
  PROMOTION_FUNDING_LABELS: fr.PROMOTION_FUNDING_LABELS,
  PROMOTION_STATUS_LABELS: fr.PROMOTION_STATUS_LABELS,
  CAMPAIGN_CHANNEL_LABELS: fr.CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_STATUS_LABELS: fr.CAMPAIGN_STATUS_LABELS,
  TICKET_STATUS_LABELS: fr.TICKET_STATUS_LABELS,
  TICKET_PRIORITY_LABELS: fr.TICKET_PRIORITY_LABELS,
  REVIEW_STATUS_LABELS: fr.REVIEW_STATUS_LABELS,
  PROSPECT_STAGE_LABELS: fr.PROSPECT_STAGE_LABELS,
  ADMIN_ROLE_LABELS: fr.ADMIN_ROLE_LABELS,
  STAFF_ROLE_LABELS: fr.STAFF_ROLE_LABELS,
  EMPLOYEE_STATUS_LABELS: fr.EMPLOYEE_STATUS_LABELS,
  CONTRACT_TYPE_LABELS: fr.CONTRACT_TYPE_LABELS,
  TIME_ENTRY_STATUS_LABELS: fr.TIME_ENTRY_STATUS_LABELS,
  WEEK_VALIDATION_STATUS_LABELS: fr.WEEK_VALIDATION_STATUS_LABELS,
  ABSENCE_TYPE_LABELS: fr.ABSENCE_TYPE_LABELS,
  REQUEST_STATUS_LABELS: fr.REQUEST_STATUS_LABELS,
  PAYSLIP_STATUS_LABELS: fr.PAYSLIP_STATUS_LABELS,
  TASK_STATUS_LABELS: fr.TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS: fr.TASK_PRIORITY_LABELS,
  CHECKLIST_KIND_LABELS: fr.CHECKLIST_KIND_LABELS,
  COMPANY_DOCUMENT_CATEGORY_LABELS: fr.COMPANY_DOCUMENT_CATEGORY_LABELS,
  EMPLOYEE_DOCUMENT_TYPE_LABELS: fr.EMPLOYEE_DOCUMENT_TYPE_LABELS,
  HACCP_SEVERITY_LABELS: fr.HACCP_SEVERITY_LABELS,
  HACCP_NC_STATUS_LABELS: fr.HACCP_NC_STATUS_LABELS,
  HACCP_FREQUENCY_LABELS: fr.HACCP_FREQUENCY_LABELS,
  ALLERGEN_LABELS: fr.ALLERGEN_LABELS,
  FEATURE_LABELS: fr.FEATURE_LABELS,
  SERVICE_HEALTH_LABELS: fr.SERVICE_HEALTH_LABELS,
  ALERT_SEVERITY_LABELS: fr.ALERT_SEVERITY_LABELS,
  GDPR_REQUEST_TYPE_LABELS: fr.GDPR_REQUEST_TYPE_LABELS,
  GDPR_REQUEST_STATUS_LABELS: fr.GDPR_REQUEST_STATUS_LABELS,
  LEGAL_DOCUMENT_LABELS: fr.LEGAL_DOCUMENT_LABELS,
  PLATFORM_ALERT_KIND_LABELS,
  PLATFORM_ALERT_STATUS_LABELS,
} as const;

export type LabelTableName = keyof typeof FR_TABLES;
type TableKeys<T extends LabelTableName> = Extract<keyof (typeof FR_TABLES)[T], string>;
type TableTranslation = { [T in LabelTableName]?: Partial<Record<TableKeys<T>, string>> };

const EN: TableTranslation = {
  MERCHANT_TYPE_LABELS: { restaurant: 'Restaurant', grocery: 'Grocery store', bakery: 'Bakery', florist: 'Florist', pharmacy: 'Pharmacy', other: 'Other business' },
  PRODUCT_SALE_UNIT_LABELS: { unit: 'Per unit', weight: 'By weight (price per kg)', variable: 'Variable price' },
  BILLING_MODE_LABELS: { commission: 'Commission on sales', subscription: 'Subscription only', hybrid: 'Subscription and commission' },
  COURIER_PAY_MODEL_LABELS: {
    flat_then_per_km: 'Flat fee below the threshold, then per kilometre',
    pickup_dropoff_per_km: 'Pickup, drop-off and kilometres (former scale)',
  },
  LOCALE_LABELS: { fr: 'French', en: 'English', ar: 'Arabic', de: 'German', lb: 'Luxembourgish', pt: 'Portuguese' },
  ORDER_STATUS_LABELS: {
    scheduled: 'Scheduled', new: 'New', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready',
    assigned: 'Courier assigned', picked_up: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
  },
  ORDER_STATUS_CLIENT_LABELS: {
    scheduled: 'Scheduled', new: 'Sent to the restaurant', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready',
    assigned: 'Ready', picked_up: 'On its way', delivered: 'Delivered', cancelled: 'Cancelled',
  },
  FULFILLMENT_LABELS: { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine-in' },
  CANCEL_REASON_LABELS: {
    customer_request: 'Cancelled by the customer', restaurant_rejected: 'Rejected by the restaurant',
    restaurant_timeout: 'Not accepted in time', restaurant_closed: 'Restaurant closed', item_unavailable: 'Item unavailable',
    no_driver_available: 'No courier available', customer_absent: 'Customer absent', address_unreachable: 'Address unreachable',
    payment_failed: 'Payment declined', fraud_suspected: 'Suspected fraud', duplicate: 'Duplicate order', other: 'Other reason',
  },
  REFUND_CAUSE_LABELS: {
    restaurant_error: 'Restaurant error', restaurant_cancelled: 'Cancelled by the restaurant', restaurant_timeout: 'Restaurant did not respond',
    item_unavailable: 'Item unavailable', missing_item: 'Missing item', food_quality: 'Food quality', delivery_late: 'Late delivery',
    delivery_issue: 'Delivery issue', courier_error: 'Courier error', customer_absent: 'Customer absent', customer_cancelled: 'Cancelled by the customer',
    commercial_gesture: 'Goodwill gesture', platform_error: 'Platform error', payment_issue: 'Payment incident',
  },
  PAYMENT_METHOD_LABELS: {
    card: 'Bank card', apple_pay: 'Apple Pay', google_pay: 'Google Pay', cash: 'Cash', meal_voucher: 'Meal vouchers', wallet: 'GoLink credit',
  },
  PAYMENT_STATUS_LABELS: {
    pending: 'Pending', requires_action: 'Action required', authorized: 'Authorized', paid: 'Paid',
    partially_refunded: 'Partially refunded', refunded: 'Refunded', failed: 'Failed', cancelled: 'Cancelled',
  },
  REFUND_STATUS_LABELS: {
    requested: 'Requested', pending_approval: 'Awaiting approval', approved: 'Approved', processed: 'Processed', rejected: 'Rejected', failed: 'Failed',
  },
  PAYOUT_STATUS_LABELS: { scheduled: 'Scheduled', processing: 'Processing', paid: 'Paid', failed: 'Failed', on_hold: 'On hold', cancelled: 'Cancelled' },
  INVOICE_KIND_LABELS: {
    customer_receipt: 'Customer receipt', commission_invoice: 'Commission invoice', subscription_invoice: 'Subscription invoice',
    driver_statement: 'Courier statement', credit_note: 'Credit note', sponsored_invoice: 'Promotion invoice',
  },
  INVOICE_STATUS_LABELS: { draft: 'Draft', issued: 'Issued', paid: 'Paid', overdue: 'Overdue', credited: 'Cancelled by credit note' },
  VAT_CATEGORY_LABELS: { food: 'Food service', soft_drink: 'Soft drink', alcohol: 'Alcoholic drink (forbidden)', grocery: 'Grocery' },
  ACCOUNT_STATUS_LABELS: { active: 'Active', blocked: 'Blocked', pending_deletion: 'Deletion requested', deleted: 'Deleted' },
  ONBOARDING_STATUS_LABELS: { draft: 'Sign-up in progress', pending: 'Pending', documents_missing: 'Missing documents', approved: 'Approved', rejected: 'Rejected' },
  RESTAURANT_STATUS_LABELS: { onboarding: 'Signing up', active: 'Active', paused: 'Paused', suspended: 'Suspended', closed: 'Permanently closed' },
  DRIVER_STATUS_LABELS: { onboarding: 'Signing up', active: 'Active', suspended: 'Suspended', deactivated: 'Deactivated' },
  DRIVER_AVAILABILITY_LABELS: { offline: 'Offline', online: 'Available', on_delivery: 'On a delivery', paused: 'Paused' },
  DRIVER_TYPE_LABELS: { platform: 'GoLink courier', restaurant: 'Business employee courier' },
  RESTAURANT_COURIER_STATUS_LABELS: { active: 'Available', inactive: 'Unavailable', blocked: 'Blocked' },
  VEHICLE_LABELS: {
    bike: 'Bike', e_bike: 'Electric bike', cargo_bike: 'Cargo bike', scooter: 'Scooter', motorbike: 'Motorbike', car: 'Car', on_foot: 'On foot',
  },
  SANCTION_TYPE_LABELS: { warning: 'Warning', temporary_suspension: 'Temporary suspension', deactivation: 'Deactivation' },
  PARTNER_DOCUMENT_LABELS: {
    kbis: 'Company registration extract', siret_notice: 'Business registration notice', manager_id: 'Manager ID', bank_details: 'Bank details',
    alcohol_license: 'Alcohol licence', hygiene_certificate: 'Hygiene training certificate', identity: 'ID document', residence_permit: 'Residence permit',
    work_permit: 'Work permit', siret_registration: 'Self-employed registration', urssaf_certificate: 'Social contributions certificate',
    insurance: 'Insurance certificate', driving_license: 'Driving licence', vehicle_registration: 'Vehicle registration', other: 'Other document',
  },
  DOCUMENT_STATUS_LABELS: { pending: 'To review', approved: 'Approved', rejected: 'Rejected', expired: 'Expired' },
  SUBSCRIPTION_STATUS_LABELS: {
    trialing: 'Trial period', active: 'Active', past_due: 'Past due', restricted: 'Restricted', suspended: 'Suspended', cancelled: 'Cancelled',
  },
  PROMOTION_KIND_LABELS: { percentage: 'Percentage', fixed: 'Fixed amount', free_delivery: 'Free delivery' },
  PROMOTION_FUNDING_LABELS: { platform: 'GoLink', restaurant: 'Restaurant', shared: 'Shared' },
  PROMOTION_STATUS_LABELS: { draft: 'Draft', pending_review: 'To approve', active: 'Active', paused: 'Paused', rejected: 'Rejected', ended: 'Ended' },
  CAMPAIGN_CHANNEL_LABELS: { push: 'Push notification', email: 'Email', sms: 'SMS', in_app: 'In-app message' },
  CAMPAIGN_STATUS_LABELS: { draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', cancelled: 'Cancelled', failed: 'Failed' },
  TICKET_STATUS_LABELS: { open: 'Open', in_progress: 'In progress', waiting_customer: 'Awaiting reply', resolved: 'Resolved', closed: 'Closed' },
  TICKET_PRIORITY_LABELS: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' },
  REVIEW_STATUS_LABELS: { published: 'Published', pending_moderation: 'Under moderation', hidden: 'Hidden', removed: 'Removed' },
  PROSPECT_STAGE_LABELS: { to_contact: 'To contact', contacted: 'Contacted', demo: 'Demo', negotiation: 'Negotiation', signed_up: 'Signed up', lost: 'Lost' },
  ADMIN_ROLE_LABELS: {
    super_admin: 'Super admin', support: 'Support', finance: 'Finance', sales: 'Sales', ops: 'Operations', city_manager: 'City manager',
  },
  STAFF_ROLE_LABELS: {
    owner: 'Owner', manager: 'Manager', kitchen: 'Kitchen', service: 'Service', accountant: 'Accounting', employee: 'Employee', custom: 'Custom role',
  },
  EMPLOYEE_STATUS_LABELS: { active: 'Active', inactive: 'Inactive', on_leave: 'On leave', terminated: 'Left the company' },
  CONTRACT_TYPE_LABELS: {
    cdi: 'Permanent contract', cdd: 'Fixed-term contract', interim: 'Temp agency', extra: 'Casual', internship: 'Internship', apprenticeship: 'Apprenticeship',
  },
  TIME_ENTRY_STATUS_LABELS: { open: 'In progress', pending: 'To approve', validated: 'Approved', corrected: 'Corrected', rejected: 'Rejected' },
  WEEK_VALIDATION_STATUS_LABELS: {
    pending: 'To approve', employee_validated: 'Approved by the employee', manager_validated: 'Approved by the manager', rejected: 'Rejected',
  },
  ABSENCE_TYPE_LABELS: {
    paid_leave: 'Paid leave', unpaid_leave: 'Unpaid leave', sick: 'Sick leave', rtt: 'Time off in lieu', training: 'Training', family_event: 'Family event', other: 'Other',
  },
  REQUEST_STATUS_LABELS: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' },
  PAYSLIP_STATUS_LABELS: { draft: 'Draft', generated: 'Generated', validated: 'Approved', sent: 'Sent' },
  TASK_STATUS_LABELS: { todo: 'To do', in_progress: 'In progress', review: 'To review', done: 'Done' },
  TASK_PRIORITY_LABELS: { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' },
  CHECKLIST_KIND_LABELS: { opening: 'Opening', closing: 'Closing', service: 'Service', other: 'Other' },
  COMPANY_DOCUMENT_CATEGORY_LABELS: {
    rules: 'Rules', procedure: 'Procedure', training: 'Training', legal: 'Legal obligations', supplier: 'Suppliers', other: 'Other',
  },
  EMPLOYEE_DOCUMENT_TYPE_LABELS: {
    contract: 'Employment contract', amendment: 'Amendment', identity: 'ID document', certificate: 'Certificate', medical: 'Medical visit', payslip: 'Payslip', other: 'Other',
  },
  HACCP_SEVERITY_LABELS: { minor: 'Minor', major: 'Major', critical: 'Critical' },
  HACCP_NC_STATUS_LABELS: { open: 'Open', in_progress: 'Being handled', resolved: 'Resolved' },
  HACCP_FREQUENCY_LABELS: { after_service: 'After every service', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' },
  ALLERGEN_LABELS: {
    gluten: 'Gluten', crustaceans: 'Crustaceans', eggs: 'Eggs', fish: 'Fish', peanuts: 'Peanuts', soy: 'Soy', milk: 'Milk', nuts: 'Tree nuts',
    celery: 'Celery', mustard: 'Mustard', sesame: 'Sesame', sulphites: 'Sulphites', lupin: 'Lupin', molluscs: 'Molluscs',
  },
  FEATURE_LABELS: {
    delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine-in', card_payment: 'Card payment', cash_payment: 'Cash payment', meal_voucher: 'Meal vouchers',
    tips: 'Tips', loyalty: 'Loyalty', referral: 'Referral', promotions: 'Promotions', driver_tracking: 'Courier tracking', stock_management: 'Stock management',
    multi_outlet: 'Multiple outlets', scheduled_orders: 'Scheduled orders', alcohol_sales: 'Alcohol sales (forbidden)', live_chat: 'Live chat',
    pos_integration: 'Point-of-sale integration', restaurant_own_drivers: 'Restaurant couriers',
  },
  SERVICE_HEALTH_LABELS: {
    operational: 'Operational', degraded: 'Degraded', partial_outage: 'Partial outage', major_outage: 'Major outage', maintenance: 'Maintenance',
  },
  ALERT_SEVERITY_LABELS: { info: 'Information', warning: 'Warning', critical: 'Critical' },
  GDPR_REQUEST_TYPE_LABELS: { access: 'Right of access', portability: 'Portability', rectification: 'Rectification', erasure: 'Erasure', objection: 'Objection' },
  GDPR_REQUEST_STATUS_LABELS: { received: 'Received', identity_check: 'Identity check', in_progress: 'In progress', completed: 'Completed', rejected: 'Rejected' },
  LEGAL_DOCUMENT_LABELS: {
    terms_client: 'Terms of use', terms_sale: 'Terms of sale', terms_restaurant: 'Restaurant partner terms', terms_driver: 'Courier partner terms',
    privacy_policy: 'Privacy policy', cookie_policy: 'Cookie policy', legal_notice: 'Legal notice',
  },
  PLATFORM_ALERT_KIND_LABELS: {
    restaurant_cancellation_rate: 'Abnormal cancellations', restaurant_rejection_rate: 'Order rejections', zone_driver_shortage: 'Courier shortage',
    refund_spike: 'Refund spike', city_order_drop: 'Order drop', service_down: 'Service down', subscription_unpaid: 'Unpaid subscription',
    restaurant_to_validate: 'Restaurant to approve', driver_to_validate: 'Courier to approve', document_expired: 'Expired document',
    ticket_escalated: 'Escalated ticket', review_reported: 'Reported review', gdpr_request: 'GDPR request', payout_failed: 'Failed payout',
    fraud_signal: 'Fraud signal', menu_quality: 'Menu quality', dispatch_failed: 'Delivery without courier',
  },
  PLATFORM_ALERT_STATUS_LABELS: { open: 'To handle', acknowledged: 'Being handled', resolved: 'Resolved', dismissed: 'Dismissed' },
};

const AR: TableTranslation = {
  MERCHANT_TYPE_LABELS: { restaurant: 'مطعم', grocery: 'بقالة', bakery: 'مخبز', florist: 'بائع زهور', pharmacy: 'صيدلية', other: 'نشاط تجاري آخر' },
  PRODUCT_SALE_UNIT_LABELS: { unit: 'بالوحدة', weight: 'بالوزن (السعر للكيلوغرام)', variable: 'سعر متغير' },
  BILLING_MODE_LABELS: { commission: 'عمولة على المبيعات', subscription: 'اشتراك فقط', hybrid: 'اشتراك وعمولة' },
  COURIER_PAY_MODEL_LABELS: {
    flat_then_per_km: 'مبلغ ثابت دون الحد ثم بالكيلومتر',
    pickup_dropoff_per_km: 'الاستلام والتسليم والكيلومترات (السلم القديم)',
  },
  LOCALE_LABELS: { fr: 'الفرنسية', en: 'الإنجليزية', ar: 'العربية', de: 'الألمانية', lb: 'اللوكسمبورغية', pt: 'البرتغالية' },
  ORDER_STATUS_LABELS: {
    scheduled: 'مجدولة', new: 'جديدة', accepted: 'مقبولة', preparing: 'قيد التحضير', ready: 'جاهزة',
    assigned: 'تم تعيين موصّل', picked_up: 'قيد التوصيل', delivered: 'تم التوصيل', cancelled: 'ملغاة',
  },
  ORDER_STATUS_CLIENT_LABELS: {
    scheduled: 'مجدولة', new: 'أُرسلت إلى المطعم', accepted: 'مقبولة', preparing: 'قيد التحضير', ready: 'جاهزة',
    assigned: 'جاهزة', picked_up: 'في الطريق', delivered: 'تم التوصيل', cancelled: 'ملغاة',
  },
  FULFILLMENT_LABELS: { delivery: 'توصيل', pickup: 'استلام من المتجر', dine_in: 'تناول في المكان' },
  CANCEL_REASON_LABELS: {
    customer_request: 'ألغاها العميل', restaurant_rejected: 'رفضها المطعم', restaurant_timeout: 'لم تُقبل في الوقت المحدد',
    restaurant_closed: 'المطعم مغلق', item_unavailable: 'منتج غير متوفر', no_driver_available: 'لا يوجد موصّل متاح', customer_absent: 'العميل غائب',
    address_unreachable: 'العنوان يتعذر الوصول إليه', payment_failed: 'تم رفض الدفع', fraud_suspected: 'اشتباه في احتيال', duplicate: 'طلب مكرر', other: 'سبب آخر',
  },
  REFUND_CAUSE_LABELS: {
    restaurant_error: 'خطأ من المطعم', restaurant_cancelled: 'إلغاء من المطعم', restaurant_timeout: 'المطعم لم يستجب',
    item_unavailable: 'منتج غير متوفر', missing_item: 'منتج ناقص', food_quality: 'جودة الطعام', delivery_late: 'تأخر التوصيل',
    delivery_issue: 'مشكلة في التوصيل', courier_error: 'خطأ من الموصّل', customer_absent: 'العميل غائب', customer_cancelled: 'إلغاء من العميل',
    commercial_gesture: 'لفتة تجارية', platform_error: 'خطأ من المنصة', payment_issue: 'حادث دفع',
  },
  PAYMENT_METHOD_LABELS: {
    card: 'بطاقة مصرفية', apple_pay: 'Apple Pay', google_pay: 'Google Pay', cash: 'نقداً', meal_voucher: 'قسائم الوجبات', wallet: 'رصيد GoLink',
  },
  PAYMENT_STATUS_LABELS: {
    pending: 'قيد الانتظار', requires_action: 'يتطلب إجراءً', authorized: 'مصرّح به', paid: 'مدفوع',
    partially_refunded: 'مسترد جزئياً', refunded: 'مسترد', failed: 'فشل', cancelled: 'ملغى',
  },
  REFUND_STATUS_LABELS: {
    requested: 'مطلوب', pending_approval: 'بانتظار الموافقة', approved: 'تمت الموافقة', processed: 'تم التنفيذ', rejected: 'مرفوض', failed: 'فشل',
  },
  PAYOUT_STATUS_LABELS: { scheduled: 'مجدول', processing: 'قيد المعالجة', paid: 'مدفوع', failed: 'فشل', on_hold: 'معلّق', cancelled: 'ملغى' },
  INVOICE_KIND_LABELS: {
    customer_receipt: 'إيصال العميل', commission_invoice: 'فاتورة العمولات', subscription_invoice: 'فاتورة الاشتراك',
    driver_statement: 'كشف الموصّل', credit_note: 'إشعار دائن', sponsored_invoice: 'فاتورة الإبراز',
  },
  INVOICE_STATUS_LABELS: { draft: 'مسودة', issued: 'صادرة', paid: 'مدفوعة', overdue: 'متأخرة', credited: 'ملغاة بإشعار دائن' },
  VAT_CATEGORY_LABELS: { food: 'مطاعم', soft_drink: 'مشروب غير كحولي', alcohol: 'مشروب كحولي (ممنوع)', grocery: 'بقالة' },
  ACCOUNT_STATUS_LABELS: { active: 'نشط', blocked: 'محظور', pending_deletion: 'طلب حذف', deleted: 'محذوف' },
  ONBOARDING_STATUS_LABELS: { draft: 'التسجيل جارٍ', pending: 'قيد الانتظار', documents_missing: 'مستندات ناقصة', approved: 'تمت الموافقة', rejected: 'مرفوض' },
  RESTAURANT_STATUS_LABELS: { onboarding: 'قيد التسجيل', active: 'نشط', paused: 'متوقف مؤقتاً', suspended: 'معلّق', closed: 'مغلق نهائياً' },
  DRIVER_STATUS_LABELS: { onboarding: 'قيد التسجيل', active: 'نشط', suspended: 'معلّق', deactivated: 'معطّل' },
  DRIVER_AVAILABILITY_LABELS: { offline: 'غير متصل', online: 'متاح', on_delivery: 'في مهمة توصيل', paused: 'متوقف مؤقتاً' },
  DRIVER_TYPE_LABELS: { platform: 'موصّل GoLink', restaurant: 'موصّل موظف لدى المتجر' },
  RESTAURANT_COURIER_STATUS_LABELS: { active: 'متاح', inactive: 'غير متاح', blocked: 'محظور' },
  VEHICLE_LABELS: {
    bike: 'دراجة', e_bike: 'دراجة كهربائية', cargo_bike: 'دراجة شحن', scooter: 'سكوتر', motorbike: 'دراجة نارية', car: 'سيارة', on_foot: 'سيراً على الأقدام',
  },
  SANCTION_TYPE_LABELS: { warning: 'إنذار', temporary_suspension: 'تعليق مؤقت', deactivation: 'تعطيل' },
  PARTNER_DOCUMENT_LABELS: {
    kbis: 'مستخرج السجل التجاري', siret_notice: 'إشعار التسجيل التجاري', manager_id: 'هوية المسؤول', bank_details: 'بيانات الحساب المصرفي',
    alcohol_license: 'رخصة بيع الكحول', hygiene_certificate: 'شهادة تدريب النظافة', identity: 'وثيقة الهوية', residence_permit: 'تصريح الإقامة',
    work_permit: 'تصريح العمل', siret_registration: 'تسجيل العمل الحر', urssaf_certificate: 'شهادة الاشتراكات الاجتماعية',
    insurance: 'شهادة التأمين', driving_license: 'رخصة القيادة', vehicle_registration: 'وثيقة تسجيل المركبة', other: 'مستند آخر',
  },
  DOCUMENT_STATUS_LABELS: { pending: 'للمراجعة', approved: 'تمت الموافقة', rejected: 'مرفوض', expired: 'منتهي الصلاحية' },
  SUBSCRIPTION_STATUS_LABELS: {
    trialing: 'فترة تجريبية', active: 'نشط', past_due: 'متأخر السداد', restricted: 'مقيّد', suspended: 'معلّق', cancelled: 'ملغى',
  },
  PROMOTION_KIND_LABELS: { percentage: 'نسبة مئوية', fixed: 'مبلغ ثابت', free_delivery: 'توصيل مجاني' },
  PROMOTION_FUNDING_LABELS: { platform: 'GoLink', restaurant: 'المطعم', shared: 'مشترك' },
  PROMOTION_STATUS_LABELS: { draft: 'مسودة', pending_review: 'للموافقة', active: 'نشط', paused: 'متوقف مؤقتاً', rejected: 'مرفوض', ended: 'منتهٍ' },
  CAMPAIGN_CHANNEL_LABELS: { push: 'إشعار فوري', email: 'بريد إلكتروني', sms: 'رسالة نصية', in_app: 'رسالة داخل التطبيق' },
  CAMPAIGN_STATUS_LABELS: { draft: 'مسودة', scheduled: 'مجدولة', sending: 'قيد الإرسال', sent: 'مرسلة', cancelled: 'ملغاة', failed: 'فشل' },
  TICKET_STATUS_LABELS: { open: 'مفتوحة', in_progress: 'قيد المعالجة', waiting_customer: 'بانتظار الرد', resolved: 'تم الحل', closed: 'مغلقة' },
  TICKET_PRIORITY_LABELS: { low: 'منخفضة', normal: 'عادية', high: 'مرتفعة', urgent: 'عاجلة' },
  REVIEW_STATUS_LABELS: { published: 'منشور', pending_moderation: 'قيد المراجعة', hidden: 'مخفي', removed: 'محذوف' },
  PROSPECT_STAGE_LABELS: { to_contact: 'للتواصل', contacted: 'تم التواصل', demo: 'عرض تجريبي', negotiation: 'تفاوض', signed_up: 'مسجّل', lost: 'خسارة' },
  ADMIN_ROLE_LABELS: {
    super_admin: 'مدير عام', support: 'الدعم', finance: 'المالية', sales: 'المبيعات', ops: 'العمليات', city_manager: 'مسؤول المدينة',
  },
  STAFF_ROLE_LABELS: {
    owner: 'المالك', manager: 'مدير', kitchen: 'المطبخ', service: 'الخدمة', accountant: 'المحاسبة', employee: 'موظف', custom: 'دور مخصص',
  },
  EMPLOYEE_STATUS_LABELS: { active: 'نشط', inactive: 'غير نشط', on_leave: 'في إجازة', terminated: 'غادر الفريق' },
  CONTRACT_TYPE_LABELS: {
    cdi: 'عقد دائم', cdd: 'عقد محدد المدة', interim: 'عمل مؤقت', extra: 'عمل إضافي', internship: 'تدريب', apprenticeship: 'تمهين',
  },
  TIME_ENTRY_STATUS_LABELS: { open: 'جارٍ', pending: 'للاعتماد', validated: 'معتمد', corrected: 'مصحّح', rejected: 'مرفوض' },
  WEEK_VALIDATION_STATUS_LABELS: {
    pending: 'للاعتماد', employee_validated: 'اعتمدها الموظف', manager_validated: 'اعتمدها المدير', rejected: 'مرفوضة',
  },
  ABSENCE_TYPE_LABELS: {
    paid_leave: 'إجازة مدفوعة', unpaid_leave: 'إجازة بدون راتب', sick: 'إجازة مرضية', rtt: 'راحة تعويضية', training: 'تدريب', family_event: 'مناسبة عائلية', other: 'أخرى',
  },
  REQUEST_STATUS_LABELS: { pending: 'قيد الانتظار', approved: 'مقبول', rejected: 'مرفوض', cancelled: 'ملغى' },
  PAYSLIP_STATUS_LABELS: { draft: 'مسودة', generated: 'منشأة', validated: 'معتمدة', sent: 'مرسلة' },
  TASK_STATUS_LABELS: { todo: 'للتنفيذ', in_progress: 'قيد التنفيذ', review: 'للمراجعة', done: 'منتهية' },
  TASK_PRIORITY_LABELS: { low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة', urgent: 'عاجلة' },
  CHECKLIST_KIND_LABELS: { opening: 'الافتتاح', closing: 'الإغلاق', service: 'الخدمة', other: 'أخرى' },
  COMPANY_DOCUMENT_CATEGORY_LABELS: {
    rules: 'اللوائح', procedure: 'الإجراءات', training: 'التدريب', legal: 'الالتزامات القانونية', supplier: 'الموردون', other: 'أخرى',
  },
  EMPLOYEE_DOCUMENT_TYPE_LABELS: {
    contract: 'عقد العمل', amendment: 'ملحق', identity: 'وثيقة الهوية', certificate: 'شهادة', medical: 'فحص طبي', payslip: 'كشف الراتب', other: 'أخرى',
  },
  HACCP_SEVERITY_LABELS: { minor: 'طفيفة', major: 'كبيرة', critical: 'حرجة' },
  HACCP_NC_STATUS_LABELS: { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تم حلها' },
  HACCP_FREQUENCY_LABELS: { after_service: 'بعد كل خدمة', daily: 'يومياً', weekly: 'أسبوعياً', monthly: 'شهرياً' },
  ALLERGEN_LABELS: {
    gluten: 'الغلوتين', crustaceans: 'القشريات', eggs: 'البيض', fish: 'السمك', peanuts: 'الفول السوداني', soy: 'الصويا', milk: 'الحليب', nuts: 'المكسرات',
    celery: 'الكرفس', mustard: 'الخردل', sesame: 'السمسم', sulphites: 'الكبريتيت', lupin: 'الترمس', molluscs: 'الرخويات',
  },
  FEATURE_LABELS: {
    delivery: 'التوصيل', pickup: 'الاستلام من المتجر', dine_in: 'تناول في المكان', card_payment: 'الدفع بالبطاقة', cash_payment: 'الدفع نقداً', meal_voucher: 'قسائم الوجبات',
    tips: 'البقشيش', loyalty: 'الولاء', referral: 'الإحالة', promotions: 'العروض', driver_tracking: 'تتبع الموصّل', stock_management: 'إدارة المخزون',
    multi_outlet: 'فروع متعددة', scheduled_orders: 'الطلبات المجدولة', alcohol_sales: 'بيع الكحول (ممنوع)', live_chat: 'الدردشة المباشرة',
    pos_integration: 'الربط بنظام نقطة البيع', restaurant_own_drivers: 'موصّلو المطعم',
  },
  SERVICE_HEALTH_LABELS: {
    operational: 'يعمل', degraded: 'أداء متراجع', partial_outage: 'عطل جزئي', major_outage: 'عطل كبير', maintenance: 'صيانة',
  },
  ALERT_SEVERITY_LABELS: { info: 'معلومة', warning: 'تنبيه', critical: 'حرج' },
  GDPR_REQUEST_TYPE_LABELS: { access: 'حق الوصول', portability: 'قابلية النقل', rectification: 'التصحيح', erasure: 'المحو', objection: 'الاعتراض' },
  GDPR_REQUEST_STATUS_LABELS: { received: 'مستلم', identity_check: 'التحقق من الهوية', in_progress: 'قيد المعالجة', completed: 'تمت المعالجة', rejected: 'مرفوض' },
  LEGAL_DOCUMENT_LABELS: {
    terms_client: 'شروط الاستخدام', terms_sale: 'شروط البيع', terms_restaurant: 'شروط شركاء المطاعم', terms_driver: 'شروط شركاء التوصيل',
    privacy_policy: 'سياسة الخصوصية', cookie_policy: 'سياسة ملفات تعريف الارتباط', legal_notice: 'الإشعار القانوني',
  },
  PLATFORM_ALERT_KIND_LABELS: {
    restaurant_cancellation_rate: 'إلغاءات غير معتادة', restaurant_rejection_rate: 'رفض الطلبات', zone_driver_shortage: 'نقص في الموصّلين',
    refund_spike: 'ارتفاع المبالغ المستردة', city_order_drop: 'انخفاض الطلبات', service_down: 'الخدمة متوقفة', subscription_unpaid: 'اشتراك غير مدفوع',
    restaurant_to_validate: 'مطعم بانتظار الموافقة', driver_to_validate: 'موصّل بانتظار الموافقة', document_expired: 'مستند منتهي الصلاحية',
    ticket_escalated: 'تذكرة مصعّدة', review_reported: 'تقييم مُبلَّغ عنه', gdpr_request: 'طلب حماية البيانات', payout_failed: 'فشل في التحويل',
    fraud_signal: 'إشارة احتيال', menu_quality: 'جودة القوائم', dispatch_failed: 'توصيلة بلا موصّل',
  },
  PLATFORM_ALERT_STATUS_LABELS: { open: 'للمعالجة', acknowledged: 'قيد المعالجة', resolved: 'تم الحل', dismissed: 'مستبعد' },
};

const TRANSLATIONS: Partial<Record<Locale, TableTranslation>> = { en: EN, ar: AR };

type LooseTables = Record<string, Record<string, string> | undefined>;

/**
 * Libellé d'une valeur d'énumération dans la langue demandée. Repli garanti :
 * langue demandée, puis français, puis la clé brute (jamais une chaîne vide).
 */
export function labelOf(table: LabelTableName, key: string, locale: Locale | string = 'fr'): string {
  const translated = (TRANSLATIONS[locale as Locale] as LooseTables | undefined)?.[table]?.[key];
  if (translated) return translated;
  return (FR_TABLES[table] as Record<string, string>)[key] ?? key;
}

/** Table complète dans la langue demandée (français en repli pour chaque clé manquante). */
export function labelsFor<T extends LabelTableName>(table: T, locale: Locale | string = 'fr'): (typeof FR_TABLES)[T] {
  const base = FR_TABLES[table];
  const overlay = (TRANSLATIONS[locale as Locale] as LooseTables | undefined)?.[table];
  return (overlay ? { ...base, ...overlay } : base) as (typeof FR_TABLES)[T];
}
