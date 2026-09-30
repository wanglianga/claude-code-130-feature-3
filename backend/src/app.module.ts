import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { Appointment, TimelineEvent } from './entities/appointment';
import { Hospital, Store, User } from './entities/core';
import {
  ColdStorage, Confirmation, CremationCertificate, FarewellRoomSlot, FeeItem, FurnaceSlot,
} from './entities/ops';
import { AlbumMedia, Followup, Locker, Memento, Shipment } from './entities/aftercare';
import {
  ContactAttempt, DispositionOrder, LockerDispositionCase, StorageAuthorization, StoragePreference,
} from './entities/storage';
import { Message, Payment } from './entities/billing';
import { WorkflowController } from './workflow/workflow.controller';
import { WorkflowService } from './workflow/workflow.service';
import { StorageController } from './workflow/storage.controller';
import { StorageService } from './workflow/storage.service';

const entities = [
  Appointment, TimelineEvent, Store, User, Hospital,
  ColdStorage, Confirmation, FarewellRoomSlot, FeeItem, FurnaceSlot, CremationCertificate,
  AlbumMedia, Followup, Locker, Memento, Shipment,
  Message, Payment,
  StoragePreference, StorageAuthorization, ContactAttempt, LockerDispositionCase, DispositionOrder,
];

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      username: process.env.DB_USER || 'petapp',
      password: process.env.DB_PASS || 'petapp123',
      database: process.env.DB_NAME || 'pet_aftercare',
      charset: 'utf8mb4',
      entities,
      synchronize: true,
      timezone: '+08:00',
    }),
    TypeOrmModule.forFeature([
      Appointment, TimelineEvent, Store, User, Hospital,
      ColdStorage, Confirmation, FarewellRoomSlot, FeeItem, FurnaceSlot, CremationCertificate,
      AlbumMedia, Followup, Locker, Memento, Shipment,
      Message, Payment,
      StoragePreference, StorageAuthorization, ContactAttempt, LockerDispositionCase, DispositionOrder,
    ]),
  ],
  controllers: [WorkflowController, StorageController],
  providers: [WorkflowService, StorageService],
})
export class AppModule {}
