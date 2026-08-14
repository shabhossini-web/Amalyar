import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post,
  Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { MAX_DOCUMENT_BYTES, RecordService } from './record.service';
import { DocumentLinkDto, DocumentUploadDto, NoteAmendDto, NoteCreateDto, PatientPatchDto } from './dto/record.dto';

/**
 * پروندهٔ بیمار — یک ریشه برای همهٔ چیزهایی که به یک بیمار مربوط‌اند.
 *
 * همهٔ مسیرها زیر `patients/:id` هستند تا مالکیت از خودِ URL پیدا باشد؛ مدرک یا
 * شرحی که بدونِ پرونده ساخته شود، همان پراکندگی‌ای است که این بازطراحی برای
 * بستنش انجام شد.
 */
@Controller('patients')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class RecordController {
  constructor(private record: RecordService) {}

  @RequirePermissions('patients.read')
  @Get(':id/record')
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.record.get(id, user);
  }

  @RequirePermissions('patients.update')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: PatientPatchDto, @CurrentUser() user: any) {
    return this.record.update(id, dto, user);
  }

  // ── مدارک ──

  @RequirePermissions('patients.read')
  @Get(':id/documents')
  documents(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.record.listDocuments(id, user);
  }

  @RequirePermissions('documents.write')
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  upload(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: any,
    @Body() dto: DocumentUploadDto,
    @CurrentUser() user: any,
  ) {
    return this.record.addDocument(id, file, dto, user);
  }

  /** مدرکِ لینکی — MRI/پاراکلینیکی که جای دیگری میزبانی می‌شود؛ فایلی آپلود نمی‌شود. */
  @RequirePermissions('documents.write')
  @Post(':id/documents/link')
  addLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DocumentLinkDto,
    @CurrentUser() user: any,
  ) {
    return this.record.addDocumentLink(id, dto, user);
  }

  /**
   * دانلود. عمداً زیرِ همان guardهاست و فایل مستقیم از دیسک سرو نمی‌شود:
   * یک URLِ ثابتِ عمومی برای مدرکِ پزشکی یعنی نشتِ اطلاعات با یک لینکِ فوروارد‌شده.
   */
  @RequirePermissions('documents.read')
  @Get('documents/:documentId/file')
  async download(
    @Param('documentId', ParseIntPipe) documentId: number,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { doc, stream } = await this.record.openDocument(documentId, user);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(doc.size));
    // inline برای عکس (پیش‌نمایش در همان صفحه)، attachment برای بقیه.
    const disposition = doc.mimeType.startsWith('image/') ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    // مدرکِ پزشکی نباید در کشِ میانی بنشیند.
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  }

  @RequirePermissions('documents.delete')
  @Delete('documents/:documentId')
  removeDocument(@Param('documentId', ParseIntPipe) documentId: number, @CurrentUser() user: any) {
    return this.record.deleteDocument(documentId, user);
  }

  // ── شرح‌های بالینی ──

  @RequirePermissions('patients.clinical.read')
  @Get(':id/notes')
  notes(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.record.listNotes(id, user);
  }

  @RequirePermissions('patients.clinical.write')
  @Post(':id/notes')
  addNote(@Param('id', ParseIntPipe) id: number, @Body() dto: NoteCreateDto, @CurrentUser() user: any) {
    return this.record.addNote(id, dto, user);
  }

  @RequirePermissions('patients.clinical.write')
  @Patch('notes/:noteId')
  amendNote(@Param('noteId', ParseIntPipe) noteId: number, @Body() dto: NoteAmendDto, @CurrentUser() user: any) {
    return this.record.amendNote(noteId, dto.body, user);
  }

  @RequirePermissions('patients.clinical.read')
  @Get('notes/:noteId/history')
  noteHistory(@Param('noteId', ParseIntPipe) noteId: number, @CurrentUser() user: any) {
    return this.record.noteHistory(noteId, user);
  }
}
