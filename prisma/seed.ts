import { GameParticipant, PrismaClient, Question } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  AnswerStatus,
  DisputeStatus,
} from '../src/repository/contracts/game-engine.dto';
import { HostRole } from '../src/game-client-admin/main/auth/auth.dto';

const prisma = new PrismaClient();

async function clearDatabase() {
  console.log('Cleaning up database...');
  await prisma.answerStatusHistory.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();

  await prisma.categoryGameRelation.deleteMany();
  await prisma.gameParticipant.deleteMany();

  await prisma.round.deleteMany();
  await prisma.game.deleteMany();
  await prisma.team.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.answerStatus.deleteMany();
  console.log('Database cleared.');
}

async function seedMetadata() {
  console.log('Seeding metadata...');
  await prisma.role.createMany({
    data: [
      { name: HostRole.HOST },
      { name: HostRole.ADMIN },
      { name: HostRole.SCORER },
    ],
  });
  await prisma.answerStatus.createMany({
    data: [
      { name: AnswerStatus.UNSET },
      { name: AnswerStatus.CORRECT },
      { name: AnswerStatus.INCORRECT },
      { name: AnswerStatus.DISPUTABLE },
    ],
  });
  await prisma.disputeStatus.createMany({
    data: [
      { name: DisputeStatus.OPEN },
      { name: DisputeStatus.RESOLVED },
      { name: DisputeStatus.CLOSED },
    ],
  });
}

async function seedTestData() {
  console.log('Seeding extended test data...');

  const hostRole = await prisma.role.findFirst({
    where: { name: HostRole.HOST },
  });
  const hashedPassword = await bcrypt.hash('password123', 10);

  const host = await prisma.user.create({
    data: {
      email: 'admin@test.com',
      password: hashedPassword,
      roleId: hostRole!.id,
    },
  });

  const category1 = await prisma.category.create({
    data: { name: 'Category A', userId: host.id },
  });

  const category2 = await prisma.category.create({
    data: { name: 'Category B', userId: host.id },
  });

  const game = await prisma.game.create({
    data: {
      hostId: host.id,
      name: 'Championship Test Game',
      passcode: 1122,
      status: 'DRAFT',
      date: new Date(),
    },
  });

  const teamNames1 = ['Alpha Team', 'Beta Team', 'Gamma Team'];
  const teamNames2 = ['Delta Team', 'Epsilon Team', 'Zeta Team'];
  const participants: GameParticipant[] = [];
  const questions: Question[] = [];

  for (const name of teamNames1) {
    const team = await prisma.team.create({
      data: {
        name,
        teamCode: `${name.split(' ')[0].toUpperCase()}_CODE`,
        managerId: host.id,
        categoryId: category1.id,
      },
    });

    const participant = await prisma.gameParticipant.create({
      data: {
        gameId: game.id,
        teamId: team.id,
        categoryId: category1.id,
      },
    });
    participants.push(participant);
  }

  for (const name of teamNames2) {
    const team = await prisma.team.create({
      data: {
        name,
        teamCode: `${name.split(' ')[0].toUpperCase()}_CODE`,
        managerId: host.id,
        categoryId: category2.id,
      },
    });

    const participant = await prisma.gameParticipant.create({
      data: {
        gameId: game.id,
        teamId: team.id,
        categoryId: category2.id,
      },
    });
    participants.push(participant);
  }

  const round = await prisma.round.create({
    data: {
      gameId: game.id,
      roundNumber: 1,
      name: 'Qualifying Round',
    },
  });

  const questionsData = [
    { text: 'What is the capital of Japan?', answer: 'Tokyo' },
    { text: 'Who wrote "1984"?', answer: 'George Orwell' },
    { text: 'Which planet is known as the Red Planet?', answer: 'Mars' },
  ];

  for (let i = 0; i < questionsData.length; i++) {
    const q = await prisma.question.create({
      data: {
        roundId: round.id,
        questionNumber: i + 1,
        text: questionsData[i].text,
        answer: questionsData[i].answer,
        timeToThink: 60,
        timeToAnswer: 10,
      },
    });
    questions.push(q);
  }

  await prisma.categoryGameRelation.createMany({
    data: [
      { gameId: game.id, categoryId: category1.id },
      { gameId: game.id, categoryId: category2.id },
    ],
  });
}

async function main() {
  await clearDatabase();
  await seedMetadata();
  await seedTestData();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
