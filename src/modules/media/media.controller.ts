import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadTaskDto } from './dto/upload-task.dto';
import { MediaService, UploadTaskResult } from './media.service';

@Controller('api/v1/media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-task')
  @HttpCode(HttpStatus.ACCEPTED)
  async uploadTask(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadTaskDto,
  ): Promise<UploadTaskResult> {
    return this.mediaService.enqueueUploadTask(user.userId, dto);
  }

  @Get('tasks/:taskId')
  async getTask(@Param('taskId') taskId: string) {
    return this.mediaService.getTaskStatus(taskId);
  }
}
