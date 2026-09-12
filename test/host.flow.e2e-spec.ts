import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/repository/prisma/prisma.service';
import { resetDb } from './helpers/db';

describe('Host flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    await resetDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('register -> create -> list -> get -> save', async () => {
    const email = `host_${Date.now()}@example.com`;
    const password = 'pass1234';

    const registerRes = await request(app.getHttpServer())
      .post('/host/register')
      .send({ email, password })
      .expect(201);

    const token: string = registerRes.body.session.access_token;
    expect(token).toBeTruthy();

    const createRes = await request(app.getHttpServer())
      .post('/host/games/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Game A', date_of_event: '2027-01-08' })
      .expect(201);

    const gameId: number = createRes.body.game.id;

    const listRes = await request(app.getHttpServer())
      .post('/host/games')
      .set('Authorization', `Bearer ${token}`)
      .send({ limit: 50, offset: 0 })
      .expect(201);

    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].id).toBe(gameId);

    const getRes = await request(app.getHttpServer())
      .post('/host/game/get')
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId })
      .expect(201);

    const saveReq = {
      game_id: gameId,
      version: getRes.body.game.version,
      game: {
        ...getRes.body.game,
        title: 'Game A (edited)',
        rounds: [
          {
            round_number: 1,
            name: 'Round 1',
            questions: [
              {
                question_number: 1,
                text: '2+2?',
                answer: '4',
                time_to_think_sec: 60,
                time_to_answer_sec: 10,
              },
            ],
          },
        ],
      },
    };

    const saveRes = await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send(saveReq)
      .expect(201);

    expect(saveRes.body.game.title).toBe('Game A (edited)');
  });

  it("rejects saving another host's team (ownership check)", async () => {
    // Host A creates a game with a category, then a team under it.
    const registerA = await request(app.getHttpServer())
      .post('/host/register')
      .send({ email: `hostA_${Date.now()}@example.com`, password: 'pass1234' })
      .expect(201);
    const tokenA: string = registerA.body.session.access_token;

    const createA = await request(app.getHttpServer())
      .post('/host/games/create')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Game A', date_of_event: '2027-02-01' })
      .expect(201);
    const gameIdA: number = createA.body.game.id;

    const getA1 = await request(app.getHttpServer())
      .post('/host/game/get')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ gameId: gameIdA })
      .expect(201);

    const saveA1 = await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        game_id: gameIdA,
        version: getA1.body.game.version,
        game: { ...getA1.body.game, categories: [{ name: 'Cat A' }] },
      })
      .expect(201);
    const categoryIdA: number = saveA1.body.game.categories[0].id;

    const saveA2 = await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        game_id: gameIdA,
        version: saveA1.body.game.version,
        game: {
          ...saveA1.body.game,
          teams: [{ name: 'Team A', team_code: 'TEAMA', category_id: categoryIdA }],
        },
      })
      .expect(201);
    const teamIdA: number = saveA2.body.game.teams[0].id;

    // Host B creates their own game + category, then tries to claim host A's
    // team id as one of their own teams in a save.
    const registerB = await request(app.getHttpServer())
      .post('/host/register')
      .send({ email: `hostB_${Date.now()}@example.com`, password: 'pass1234' })
      .expect(201);
    const tokenB: string = registerB.body.session.access_token;

    const createB = await request(app.getHttpServer())
      .post('/host/games/create')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'Game B', date_of_event: '2027-02-02' })
      .expect(201);
    const gameIdB: number = createB.body.game.id;

    const getB1 = await request(app.getHttpServer())
      .post('/host/game/get')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ gameId: gameIdB })
      .expect(201);

    const saveB1 = await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        game_id: gameIdB,
        version: getB1.body.game.version,
        game: { ...getB1.body.game, categories: [{ name: 'Cat B' }] },
      })
      .expect(201);
    const categoryIdB: number = saveB1.body.game.categories[0].id;

    await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        game_id: gameIdB,
        version: saveB1.body.game.version,
        game: {
          ...saveB1.body.game,
          teams: [
            { id: teamIdA, name: 'Hijacked', team_code: 'HACK', category_id: categoryIdB },
          ],
        },
      })
      .expect(404);

    // Host A's own view of their team must be unaffected by host B's attempt.
    const getA2 = await request(app.getHttpServer())
      .post('/host/game/get')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ gameId: gameIdA })
      .expect(201);
    expect(getA2.body.game.teams[0].name).toBe('Team A');
  });

  it('LIVE game: allows adding a team and editing an unplayed question, blocks touching a played one', async () => {
    const register = await request(app.getHttpServer())
      .post('/host/register')
      .send({ email: `hostLive_${Date.now()}@example.com`, password: 'pass1234' })
      .expect(201);
    const token: string = register.body.session.access_token;

    const create = await request(app.getHttpServer())
      .post('/host/games/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Live Game', date_of_event: '2027-05-01' })
      .expect(201);
    const gameId: number = create.body.game.id;

    const get1 = await request(app.getHttpServer())
      .post('/host/game/get')
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId })
      .expect(201);

    // One category, one team, one round with two questions.
    const save1 = await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        game_id: gameId,
        version: get1.body.game.version,
        game: {
          ...get1.body.game,
          categories: [{ name: 'Cat' }],
        },
      })
      .expect(201);
    const categoryId: number = save1.body.game.categories[0].id;

    const save2 = await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        game_id: gameId,
        version: save1.body.game.version,
        game: {
          ...save1.body.game,
          teams: [{ name: 'Team 1', team_code: 'T1', category_id: categoryId }],
          rounds: [
            {
              round_number: 1,
              name: 'Round 1',
              questions: [
                { question_number: 1, text: 'Q1', answer: 'A1', time_to_think_sec: 60, time_to_answer_sec: 10 },
                { question_number: 2, text: 'Q2', answer: 'A2', time_to_think_sec: 60, time_to_answer_sec: 10 },
              ],
            },
          ],
        },
      })
      .expect(201);

    const teamId: number = save2.body.game.teams[0].id;
    const [q1, q2] = save2.body.game.rounds[0].questions;
    const participant = await prisma.gameParticipant.findFirstOrThrow({
      where: { gameId, teamId },
    });

    // Move the game LIVE, mark Q1 active, and give it a submitted answer —
    // this is the state the running session actually depends on.
    await prisma.game.update({ where: { id: gameId }, data: { status: 'LIVE' } });
    await prisma.question.update({ where: { id: q1.id }, data: { isActive: true } });
    // AnswerStatus is normally seeded via prisma/seed.ts, which the e2e DB
    // (reset via TRUNCATE between runs, not reseeded) doesn't have.
    const unsetStatus =
      (await prisma.answerStatus.findFirst({ where: { name: 'UNSET' } })) ??
      (await prisma.answerStatus.create({ data: { name: 'UNSET' } }));
    await prisma.answer.create({
      data: {
        gameParticipantId: participant.id,
        questionId: q1.id,
        answerText: 'guess',
        submittedAt: new Date(),
        statusId: unsetStatus.id,
      },
    });

    const getLive = await request(app.getHttpServer())
      .post('/host/game/get')
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId })
      .expect(201);
    const liveVersion = getLive.body.game.version;

    // Adding a new (late-arriving) team must still work while LIVE.
    const addTeamRes = await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        game_id: gameId,
        version: liveVersion,
        game: {
          ...getLive.body.game,
          teams: [
            ...getLive.body.game.teams,
            { name: 'Late Team', team_code: 'LATE', category_id: categoryId },
          ],
        },
      })
      .expect(201);
    expect(addTeamRes.body.game.teams).toHaveLength(2);
    const versionAfterAddTeam = addTeamRes.body.game.version;

    // Editing Q2 (never played) must still work while LIVE.
    const editQ2Res = await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        game_id: gameId,
        version: versionAfterAddTeam,
        game: {
          ...addTeamRes.body.game,
          rounds: [
            {
              ...addTeamRes.body.game.rounds[0],
              questions: [
                q1,
                { ...q2, text: 'Q2 (edited)' },
              ],
            },
          ],
        },
      })
      .expect(201);
    expect(editQ2Res.body.game.rounds[0].questions[1].text).toBe('Q2 (edited)');
    const versionAfterEditQ2 = editQ2Res.body.game.version;

    // Editing Q1 (active + already answered) must be rejected.
    await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        game_id: gameId,
        version: versionAfterEditQ2,
        game: {
          ...editQ2Res.body.game,
          rounds: [
            {
              ...editQ2Res.body.game.rounds[0],
              questions: [
                { ...q1, text: 'Q1 (tampered)' },
                editQ2Res.body.game.rounds[0].questions[1],
              ],
            },
          ],
        },
      })
      .expect(409);

    // Deleting Q1 must be rejected.
    await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        game_id: gameId,
        version: versionAfterEditQ2,
        game: editQ2Res.body.game,
        deleted_question_ids: [q1.id],
      })
      .expect(409);

    // Removing the team that already answered must be rejected.
    await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        game_id: gameId,
        version: versionAfterEditQ2,
        game: editQ2Res.body.game,
        deleted_team_ids: [teamId],
      })
      .expect(409);
  });

  it('FINISHED game: rejects any edit at all', async () => {
    const register = await request(app.getHttpServer())
      .post('/host/register')
      .send({ email: `hostFinished_${Date.now()}@example.com`, password: 'pass1234' })
      .expect(201);
    const token: string = register.body.session.access_token;

    const create = await request(app.getHttpServer())
      .post('/host/games/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Finished Game', date_of_event: '2027-06-01' })
      .expect(201);
    const gameId: number = create.body.game.id;

    const get1 = await request(app.getHttpServer())
      .post('/host/game/get')
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId })
      .expect(201);

    await prisma.game.update({ where: { id: gameId }, data: { status: 'FINISHED' } });

    await request(app.getHttpServer())
      .post('/host/game/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        game_id: gameId,
        version: get1.body.game.version,
        game: { ...get1.body.game, title: 'Renamed after finish' },
      })
      .expect(409);
  });
});
