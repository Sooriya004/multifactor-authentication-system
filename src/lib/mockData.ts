export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: 'admin' | 'member';
  isPrimaryAdmin: boolean;
  status: 'active' | 'blocked' | 'pending';
  houseId: string;
  joinedAt: string;
}

export interface House {
  id: string;
  name: string;
  code: string;
  createdBy: string;
  createdAt: string;
}

export interface AccessLog {
  id: string;
  userId: string;
  userName: string;
  timestamp: string;
  action: string;
  method: string;
  result: 'success' | 'failed' | 'alert';
  ipAddress: string;
  deviceId?: string;
}

export interface JoinRequest {
  id: string;
  userId: string;
  userName: string;
  email: string;
  houseCode: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface Credential {
  id: string;
  type: 'rfid' | 'fingerprint' | 'keypad';
  registered: boolean;
  registeredAt?: string;
}

export interface AuthMethod {
  id: string;
  type: 'rfid' | 'fingerprint' | 'keypad' | 'otp';
  enabled: boolean;
  priority: number;
  hasCredential: boolean;
}

export const mockUsers: User[] = [
  { id: '1', fullName: 'Alex Morgan', email: 'alex@fortinest.com', phone: '+1234567890', role: 'admin', isPrimaryAdmin: true, status: 'active', houseId: 'h1', joinedAt: '2025-01-15' },
  { id: '2', fullName: 'Jordan Lee', email: 'jordan@mail.com', phone: '+1234567891', role: 'admin', isPrimaryAdmin: false, status: 'active', houseId: 'h1', joinedAt: '2025-02-10' },
  { id: '3', fullName: 'Sam Rivera', email: 'sam@mail.com', phone: '+1234567892', role: 'member', isPrimaryAdmin: false, status: 'active', houseId: 'h1', joinedAt: '2025-03-01' },
  { id: '4', fullName: 'Casey Kim', email: 'casey@mail.com', phone: '+1234567893', role: 'member', isPrimaryAdmin: false, status: 'blocked', houseId: 'h1', joinedAt: '2025-03-15' },
];

export const mockLogs: AccessLog[] = Array.from({ length: 50 }, (_, i) => ({
  id: `log-${i}`,
  userId: mockUsers[i % 4].id,
  userName: mockUsers[i % 4].fullName,
  timestamp: new Date(Date.now() - i * 3600000 * Math.random() * 5).toISOString(),
  action: ['Door Access', 'Gate Open', 'System Login', 'Config Change', 'Credential Update'][i % 5],
  method: ['RFID', 'Fingerprint', 'Keypad', 'OTP', 'Password'][i % 5],
  result: (['success', 'success', 'success', 'failed', 'alert'] as const)[i % 5],
  ipAddress: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  deviceId: i % 3 === 0 ? `DEV-${1000 + i}` : undefined,
})).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

export const mockJoinRequests: JoinRequest[] = [
  { id: 'jr1', userId: '5', userName: 'Taylor Swift', email: 'taylor@mail.com', houseCode: 'NEST-A1B2', requestedAt: '2025-12-20', status: 'pending' },
  { id: 'jr2', userId: '6', userName: 'Drew Parker', email: 'drew@mail.com', houseCode: 'NEST-A1B2', requestedAt: '2025-12-19', status: 'pending' },
];

export const mockCredentials: Credential[] = [
  { id: 'c1', type: 'rfid', registered: true, registeredAt: '2025-06-01' },
  { id: 'c2', type: 'fingerprint', registered: false },
  { id: 'c3', type: 'keypad', registered: true, registeredAt: '2025-07-15' },
];

export const mockAuthMethods: AuthMethod[] = [
  { id: 'am1', type: 'rfid', enabled: true, priority: 1, hasCredential: true },
  { id: 'am2', type: 'fingerprint', enabled: false, priority: 2, hasCredential: false },
  { id: 'am3', type: 'keypad', enabled: true, priority: 3, hasCredential: true },
  { id: 'am4', type: 'otp', enabled: false, priority: 4, hasCredential: true },
];
