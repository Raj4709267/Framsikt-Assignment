import type { ChatService } from './chat.interface.js';

export class MockChatService implements ChatService {
  readonly notifications: Array<{ recipientType: 'employee' | 'office'; recipientId: number; message: string; createdAt: string }> = [];

  async notifyEmployee(employeeId: number, message: string): Promise<void> {
    this.notifications.push({ recipientType: 'employee', recipientId: employeeId, message, createdAt: new Date().toISOString() });
  }

  async notifyOffice(officeId: number, message: string): Promise<void> {
    this.notifications.push({ recipientType: 'office', recipientId: officeId, message, createdAt: new Date().toISOString() });
  }
}
