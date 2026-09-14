import {
  Body, Controller, Delete, ForbiddenException, Get, NotFoundException,
  Param, Patch, Post, Req, UseGuards, Query,
} from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthorizationService } from '../../auth/authorization.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { CreateAccessGrantDto } from './dto/access-grant.dto';
import { DocumentService } from './services/document.service';

@Controller('seniors/:seniorId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private getUserId(req: Request): string {
    const user = (req as Request & { user?: { sub?: string } }).user;
    const userId = user?.sub;
    if (!userId) throw new ForbiddenException('Authentication required.');
    return userId;
  }

  private async assertAccess(req: Request, seniorId: string): Promise<void> {
    const userId = this.getUserId(req);
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
  }

  @Post()
  @Roles('FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR')
  async upload(
    @Param('seniorId') seniorId: string,
    @Body() dto: UploadDocumentDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = this.getUserId(req);
    const fileBuffer = Buffer.from(dto.fileContent, 'base64');
    return this.documentService.createDocument(seniorId, userId, {
      title: dto.title,
      category: dto.category || undefined,
      description: dto.description || undefined,
      contentType: dto.contentType,
      fileName: dto.fileName,
      fileContent: dto.fileContent,
    });
  }

  @Get()
  async list(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = this.getUserId(req);
    return this.documentService.listDocuments(seniorId, userId);
  }

  @Get(':documentId')
  async getOne(
    @Param('seniorId') seniorId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = this.getUserId(req);
    return this.documentService.getDocument(seniorId, documentId, userId);
  }

  @Get(':documentId/download')
  async download(
    @Param('seniorId') seniorId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = this.getUserId(req);
    return this.documentService.downloadDocument(seniorId, documentId, userId);
  }

  @Post(':documentId/access')
  @Roles('FAMILY_ADMIN', 'DOCTOR')
  async grantAccess(
    @Param('seniorId') seniorId: string,
    @Param('documentId') documentId: string,
    @Body() dto: CreateAccessGrantDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = this.getUserId(req);
    return this.documentService.grantAccess(seniorId, documentId, userId, dto.userId, dto.expiresAt);
  }

  @Get(':documentId/access')
  async listAccess(
    @Param('seniorId') seniorId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = this.getUserId(req);
    return this.documentService.listGrants(seniorId, documentId, userId);
  }

  @Delete(':documentId/access/:grantId')
  @Roles('FAMILY_ADMIN', 'DOCTOR')
  async revokeAccess(
    @Param('seniorId') seniorId: string,
    @Param('documentId') documentId: string,
    @Param('grantId') grantId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = this.getUserId(req);
    return this.documentService.revokeGrant(seniorId, documentId, grantId, userId);
  }

  @Patch(':documentId/archive')
  @Roles('FAMILY_ADMIN', 'DOCTOR')
  async archive(
    @Param('seniorId') seniorId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = this.getUserId(req);
    return this.documentService.archiveDocument(seniorId, documentId, userId);
  }
}
