import type {
  BookingRequestCreationInput,
  CustomerBookingRequestListQuery,
  NotificationListQuery,
  ProviderBookingRequestListQuery,
} from "@evently/shared";
import type {
  BookingDecisionResult,
  BookingRequestRepository,
} from "./repository.js";

export interface BookingService {
  createRequest(
    customerUserId: string,
    input: BookingRequestCreationInput,
  ): ReturnType<BookingRequestRepository["createRequest"]>;
  listCustomerRequests(
    customerUserId: string,
    query: CustomerBookingRequestListQuery,
  ): ReturnType<BookingRequestRepository["listCustomerRequests"]>;
  findCustomerRequest(
    customerUserId: string,
    requestId: string,
  ): ReturnType<BookingRequestRepository["findCustomerRequest"]>;
  listProfessionalRequests(
    professionalUserId: string,
    query: ProviderBookingRequestListQuery,
  ): ReturnType<BookingRequestRepository["listProfessionalRequests"]>;
  findProfessionalRequest(
    professionalUserId: string,
    requestId: string,
  ): ReturnType<BookingRequestRepository["findProfessionalRequest"]>;
  decideRequest(
    professionalUserId: string,
    requestId: string,
    decision: "accepted" | "declined",
  ): Promise<BookingDecisionResult>;
  listNotifications(
    recipientUserId: string,
    query: NotificationListQuery,
  ): ReturnType<BookingRequestRepository["listNotifications"]>;
  markNotificationRead(
    recipientUserId: string,
    notificationId: string,
  ): ReturnType<BookingRequestRepository["markNotificationRead"]>;
}

export class MarketplaceBookingService implements BookingService {
  constructor(private readonly bookings: BookingRequestRepository) {}

  createRequest(customerUserId: string, input: BookingRequestCreationInput) {
    return this.bookings.createRequest(customerUserId, input);
  }

  listCustomerRequests(
    customerUserId: string,
    query: CustomerBookingRequestListQuery,
  ) {
    return this.bookings.listCustomerRequests(customerUserId, query);
  }

  findCustomerRequest(customerUserId: string, requestId: string) {
    return this.bookings.findCustomerRequest(customerUserId, requestId);
  }

  listProfessionalRequests(
    professionalUserId: string,
    query: ProviderBookingRequestListQuery,
  ) {
    return this.bookings.listProfessionalRequests(professionalUserId, query);
  }

  findProfessionalRequest(professionalUserId: string, requestId: string) {
    return this.bookings.findProfessionalRequest(professionalUserId, requestId);
  }

  decideRequest(
    professionalUserId: string,
    requestId: string,
    decision: "accepted" | "declined",
  ) {
    return this.bookings.decideRequest(professionalUserId, requestId, decision);
  }

  listNotifications(recipientUserId: string, query: NotificationListQuery) {
    return this.bookings.listNotifications(recipientUserId, query);
  }

  markNotificationRead(recipientUserId: string, notificationId: string) {
    return this.bookings.markNotificationRead(recipientUserId, notificationId);
  }
}
