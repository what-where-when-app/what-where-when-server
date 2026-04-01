import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { GameEngineService } from '../../../game-engine/main/service/game-engine.service';
import {
  GameRepository,
  type GameExportParticipant,
} from '../../../repository/game.repository';
import { HostGameRepository } from '../../../repository/host.game.repository';
import {
  AnswerStatus,
  type LeaderboardEntry,
} from '../../../repository/contracts/game-engine.dto';

function questionColumnIndex(globalIndex: number): number {
  return 5 + globalIndex;
}

function colLetter(colIndex1Based: number): string {
  let n = colIndex1Based;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function fillSolid(argb: string): ExcelJS.FillPattern {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb },
  };
}

const TITLE_FILL = 'FF4472C4';
const TITLE_FONT = 'FFFFFFFF';
const CATEGORY_FILL = 'FFB4C7E7';
const TABLE_HEADER_FILL = 'FFDCE6F1';
const TUR_FILL = 'FF9BC2E6';
const MATRIX_HEADER_FILL = 'FFD9E1F2';
const ZEBRA_FILL = 'FFF2F2F2';
const CORRECT_FILL = 'FFC6EFCE';
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB4B4B4' } },
  left: { style: 'thin', color: { argb: 'FFB4B4B4' } },
  bottom: { style: 'thin', color: { argb: 'FFB4B4B4' } },
  right: { style: 'thin', color: { argb: 'FFB4B4B4' } },
};

function styleTitle(cell: ExcelJS.Cell) {
  cell.fill = fillSolid(TITLE_FILL);
  cell.font = { bold: true, size: 14, color: { argb: TITLE_FONT } };
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
}

function styleCategoryTitle(cell: ExcelJS.Cell) {
  cell.fill = fillSolid(CATEGORY_FILL);
  cell.font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
}

function styleTableHeader(cell: ExcelJS.Cell) {
  cell.fill = fillSolid(TABLE_HEADER_FILL);
  cell.font = { bold: true, color: { argb: 'FF1F2937' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = BORDER;
}

function styleTurCell(cell: ExcelJS.Cell) {
  cell.fill = fillSolid(TUR_FILL);
  cell.font = { bold: true, color: { argb: 'FF1F2937' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = BORDER;
}

function styleMatrixHeader(cell: ExcelJS.Cell) {
  cell.fill = fillSolid(MATRIX_HEADER_FILL);
  cell.font = { bold: true, color: { argb: 'FF1F2937' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = BORDER;
}

function styleMatrixData(cell: ExcelJS.Cell, zebra: boolean) {
  if (zebra) cell.fill = fillSolid(ZEBRA_FILL);
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = BORDER;
}

function styleCorrect(cell: ExcelJS.Cell) {
  cell.fill = fillSolid(CORRECT_FILL);
  cell.font = { bold: true, color: { argb: 'FF006100' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = BORDER;
}

/** Порядок команд как в общем лидерборде, отфильтрованный по категории. */
function leaderboardEntriesForCategory(
  leaderboard: LeaderboardEntry[],
  participants: GameExportParticipant[],
  categoryId: number,
): LeaderboardEntry[] {
  const inCategory = new Set(
    participants
      .filter((p) => p.categoryId === categoryId)
      .map((p) => p.participantId),
  );
  return leaderboard.filter((e) => inCategory.has(e.participantId));
}

@Injectable()
export class GameExportService {
  constructor(
    private readonly hostGameRepository: HostGameRepository,
    private readonly gameRepository: GameRepository,
    private readonly gameEngine: GameEngineService,
  ) {}

  async buildGameXlsx(hostId: number, gameId: number): Promise<Buffer> {
    const gameMeta = await this.hostGameRepository.getHostGameDetails({
      hostId,
      gameId,
    });
    if (!gameMeta) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Game not found',
      });
    }

    const [
      questionCols,
      exportParticipants,
      leaderboard,
      answers,
    ] = await Promise.all([
      this.gameRepository.getGameExportQuestionColumns(gameId),
      this.gameRepository.getGameExportParticipants(gameId),
      this.gameEngine.getLeaderboard(gameId),
      this.gameRepository.getAnswersByGame(gameId),
    ]);

    const categoriesOrdered = [
      ...new Map(
        exportParticipants.map((p) => [p.categoryId, p.categoryName] as const),
      ).entries(),
    ].sort((a, b) => a[1].localeCompare(b[1], 'ru'));

    const participantById = new Map(
      exportParticipants.map((p) => [p.participantId, p]),
    );

    const answerByParticipant = new Map<number, Map<number, string>>();
    for (const a of answers) {
      let m = answerByParticipant.get(a.participantId);
      if (!m) {
        m = new Map();
        answerByParticipant.set(a.participantId, m);
      }
      m.set(a.questionId, a.status);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Game', {
      properties: { defaultRowHeight: 18 },
    });

    const titleCell = ws.getCell('B2');
    titleCell.value = gameMeta.title;
    styleTitle(titleCell);

    let row = 3;
    for (const [categoryId, categoryName] of categoriesOrdered) {
      const catEntries = leaderboardEntriesForCategory(
        leaderboard,
        exportParticipants,
        categoryId,
      );
      if (catEntries.length === 0) continue;

      const catTitle = ws.getCell(`B${row}`);
      catTitle.value = categoryName;
      styleCategoryTitle(catTitle);
      row++;

      for (const [col, label] of [
        ['B', 'Место'],
        ['C', 'Команда'],
        ['D', 'Кол вопросов'],
      ] as const) {
        const c = ws.getCell(`${col}${row}`);
        c.value = label;
        styleTableHeader(c);
      }
      row++;

      catEntries.forEach((e, idx) => {
        ws.getCell(`B${row}`).value = idx + 1;
        ws.getCell(`C${row}`).value = e.teamName;
        ws.getCell(`D${row}`).value = e.rating;
        row++;
      });

      row++;
    }

    row++;
    const matrixStartRow = row;

    const roundBounds = new Map<number, { min: number; max: number }>();
    for (const col of questionCols) {
      const c = questionColumnIndex(col.globalIndex);
      const ex = roundBounds.get(col.roundNumber);
      if (!ex) {
        roundBounds.set(col.roundNumber, { min: c, max: c });
      } else {
        ex.min = Math.min(ex.min, c);
        ex.max = Math.max(ex.max, c);
      }
    }

    const roundNumbersSorted = [...roundBounds.keys()].sort((a, b) => a - b);
    for (const rn of roundNumbersSorted) {
      const { min, max } = roundBounds.get(rn)!;
      const start = `${colLetter(min)}${matrixStartRow}`;
      const end = `${colLetter(max)}${matrixStartRow}`;
      if (min !== max) {
        ws.mergeCells(`${start}:${end}`);
      }
      const cell = ws.getCell(start);
      cell.value = `${rn} tur`;
      styleTurCell(cell);
    }

    const headerRow = matrixStartRow + 1;
    const fixedHeaders: [string, string][] = [
      ['B', '№'],
      ['C', 'Команда'],
      ['D', 'Код команды'],
      ['E', 'sum'],
    ];
    for (const [col, label] of fixedHeaders) {
      const c = ws.getCell(`${col}${headerRow}`);
      c.value = label;
      styleMatrixHeader(c);
    }

    for (const col of questionCols) {
      const cIdx = questionColumnIndex(col.globalIndex);
      const c = ws.getCell(`${colLetter(cIdx)}${headerRow}`);
      c.value = col.globalIndex;
      styleMatrixHeader(c);
    }

    const dataStartRow = headerRow + 1;
    leaderboard.forEach((entry, idx) => {
      const rowNum = dataStartRow + idx;
      const zebra = idx % 2 === 1;
      const p = participantById.get(entry.participantId);
      const fixed: [string, string | number][] = [
        ['B', idx + 1],
        ['C', entry.teamName],
        ['D', p?.teamCode ?? ''],
        ['E', entry.score],
      ];
      for (const [col, val] of fixed) {
        const cell = ws.getCell(`${col}${rowNum}`);
        cell.value = val;
        styleMatrixData(cell, zebra);
      }

      const pmap = answerByParticipant.get(entry.participantId);
      for (const col of questionCols) {
        const cIdx = questionColumnIndex(col.globalIndex);
        const cell = ws.getCell(`${colLetter(cIdx)}${rowNum}`);
        const st = pmap?.get(col.questionId);
        if (st === AnswerStatus.CORRECT) {
          cell.value = 1;
          styleCorrect(cell);
        } else {
          cell.value = '';
          styleMatrixData(cell, zebra);
        }
      }
    });

    ws.getColumn(2).width = 8;
    ws.getColumn(3).width = 28;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 8;

    const lastQCol =
      questionCols.length > 0
        ? questionColumnIndex(questionCols[questionCols.length - 1].globalIndex)
        : 5;
    for (let c = 6; c <= lastQCol; c++) {
      ws.getColumn(c).width = 4;
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
}
