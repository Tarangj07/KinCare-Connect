import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../database/prisma.module';
import { StorageModule } from '../../storage/storage.module';
import { DocumentController } from './documents.controller';
import { DocumentService } from './services/document.service';

@Module({
  imports: [PrismaModule, AuthModule, StorageModule],
  controllers: [DocumentController],
  providers: [DocumentService],
})
export class DocumentsModule {}
