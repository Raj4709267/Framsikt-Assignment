export interface ChatService {
  notifyEmployee(employeeId: number, message: string): Promise<void>;
  notifyOffice(officeId: number, message: string): Promise<void>;
  readonly notifications?: Array<{ recipientType: 'employee' | 'office'; recipientId: number; message: string; createdAt: string }>;
}
