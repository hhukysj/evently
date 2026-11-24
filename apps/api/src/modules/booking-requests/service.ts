import type {
  BookingCancellationInput,
  BookingMessageInput,
  BookingMessagesListQuery,
  BookingRequestCreationInput,
  CustomerBookingRequestListQuery,
  NotificationListQuery,
  ProviderBookingRequestListQuery,
} from "@evently/shared";
import type {
  BookingDecisionResult,
  BookingCancellationResult,
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
  cancelRequest(
    actorUserId: string,
    requestId: string,
    input: BookingCancellationInput,
  ): Promise<BookingCancellationResult>;
  listMessages(
    actorUserId: string,
    requestId: string,
    query: BookingMessagesListQuery,
  ): ReturnType<BookingRequestRepository["listMessages"]>;
  sendMessage(
    actorUserId: string,
    requestId: string,
    input: BookingMessageInput,
  ): ReturnType<BookingRequestRepository["sendMessage"]>;
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

  cancelRequest(
    actorUserId: string,
    requestId: string,
    input: BookingCancellationInput,
  ) {
    return this.bookings.cancelRequest(actorUserId, requestId, input);
  }

  listMessages(
    actorUserId: string,
    requestId: string,
    query: BookingMessagesListQuery,
  ) {
    return this.bookings.listMessages(actorUserId, requestId, query);
  }

  sendMessage(
    actorUserId: string,
    requestId: string,
    input: BookingMessageInput,
  ) {
    return this.bookings.sendMessage(actorUserId, requestId, input);
  }

  listNotifications(recipientUserId: string, query: NotificationListQuery) {
    return this.bookings.listNotifications(recipientUserId, query);
  }

  markNotificationRead(recipientUserId: string, notificationId: string) {
    return this.bookings.markNotificationRead(recipientUserId, notificationId);
  }
}
