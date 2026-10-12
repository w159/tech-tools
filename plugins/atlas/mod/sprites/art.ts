// Hand-drawn creature pixel art for sprite sizes m (12x12 px = 12x6 cells) and l (16x16 px = 16x8 cells).
// '.' = empty. Legend: k outline, f fill, m dark fill, h light fill, a accent, g gold, y pale yellow, w white,
// b brown, s steel, d dark steel, c cyan, t coat, r red, o orange, e eye (2x2), n nose.
// Column 0 and the last column stay free of the body so neighbouring sprites never merge; props may use them.
export const ART: Record<string, { m: string[]; l: string[] }> = {
  // Maestro Lion: crown, mane, baton, cape.
  lead: {
    m: [
      '...g.gg.g...', '...gggggg..g', '..kmmmmmmk.b', '.kmhhhhhhmkb', '.kheehheehkb', '.kheehheehkb',
      '.khhhnnhhhkb', '..kkmmmmkkhh', '.krktwwtkrkh', '.krktaatkrk.', 'krrkttttkrrk', 'kkkkkkkkkkkk',
    ],
    l: [
      '.....g.gg.g.....', '.....gggggg....g', '....kgrggrgk...b', '...kmmmmmmmmk..b', '..kmmhhhhhhmmk.b', '..kmhhhhhhhhmk.b',
      '..kmheehheehmk.b', '..kmheehheehmk.b', '..kmhhhnnhhhmk.b', '...kmmhhhhmmk..b', '....kkmmmmkk..hh', '..krkttwwttkrkh.',
      '..krkttaattkrk..', '..krkttttttkrk..', '.krrkttttttkrrk.', '.kkkkkkkkkkkkkk.',
    ],
  },
  // Lantern Fox: pointed ears, white muzzle, scarf, big lantern.
  explorer: {
    m: [
      '..kk....kk..', '..kfk..kfk..', '..kffkkffk..', '.kffffffffk.', '.kfeeffeefk.', '.kfeeffeefk.',
      '.kfwwnnwwfk.', '..kkwwwwkk..', '.kaaaaak..s.', '.kfwwwfk.ddd', '.kfffffk.dyd', '.kkkkkkk.ddd',
    ],
    l: [
      '...kk......kk...', '...kfk....kfk...', '...kffkkkkffk...', '...kffffffffk...', '..kffffffffffk..', '..kffeeffeeffk..',
      '..kffeeffeeffk..', '..kfwwwwwwwwfk..', '...kfwwnnwwfk...', '....kkwwwwkk....', '...kaaaaaak..s..', '...kffffffk.ddd.',
      '...kfwwwwfk.dyd.', '...kffffffk.dyd.', '...kkkkkkkk.ddd.', '...kkk..kkk.....',
    ],
  },
  // Hammer Bear: hardhat, wide muzzle, overalls, hammer.
  implementer: {
    m: [
      '..kkkkkkkk..', '.kggggggggk.', '.kffffffffk.', '.kfeeffeefk.', '.kfeeffeefk.', '.kfwwnnwwfk.',
      '..kkwwwwkk..', '.kfffffk.sss', '.kafffak.sss', '.kaaaaak..b.', '.kaaaaak..b.', '.kkkkkkk..b.',
    ],
    l: [
      '....kkkkkkkk....', '...kggggggggk...', '..kggggggggggk..', '...kffffffffk...', '..kffffffffffk..', '..kffeeffeeffk..',
      '..kffeeffeeffk..', '..kfwwwwwwwwfk..', '..kfwwwnnwwwfk..', '...kkwwwwwwkk...', '...kffffffk.sss.', '...kaffffak.sss.',
      '...kaaaaaak..b..', '...kaaaaaak..b..', '...kkkkkkkk..b..', '...kkk..kkk..b..',
    ],
  },
  // Squint Owl: huge eyes, beak, magnifying glass.
  verifier: {
    m: [
      '..kk....kk..', '..kfkkkkfk..', '.kwwwffwwwk.', '.kweeaaeewk.', '.kweeffeewk.', '.kwwwffwwwk.',
      '..kffffffk..', '..kkkkkkkk..', '.kfffffk.sss', '.kfwwwfk.scs', '.kfwwwfk.sss', '.kkkkkkk..b.',
    ],
    l: [
      '...kk......kk...', '...kfk....kfk...', '...kffffffffk...', '..kffffffffffk..', '..kwwwwffwwwwk..', '..kweewffweewk..',
      '..kweewaaweewk..', '..kwwwwaawwwwk..', '...kffffffffk...', '....kkkkkkkk....', '..kffffffk.ssss.', '..kfwwwwfk.sccs.',
      '..kfwwwwfk.sccs.', '..kffffffk.ssss.', '..kkkkkkkk.b....', '...kk..kk...b...',
    ],
  },
  // Sprint Hare: tall ears, running legs, speed lines.
  runner: {
    m: [
      '...kk..kk...', '...kf..fk...', '...kf..fk...', '..kffffffk..', '.kfeeffeefk.', '.kfeeffeefk.',
      '.kfffnnfffk.', '..kkkwwkkk..', 's..kfaafk...', 'ss.kkkkkk...', '..kfk..kfk..', '.kkk....kkk.',
    ],
    l: [
      '.....kk..kk.....', '....kfak.kafk...', '....kfak.kafk...', '....kfak.kafk...', '...kffffffffk...', '..kffffffffffk..',
      '..kffeeffeeffk..', '..kffeeffeeffk..', '..kffffnnffffk..', '...kkffwwffkk...', '.ss.kffffffk....', 'sss.kfaaaafk....',
      '.ss.kfaaaafk....', '....kkkkkkkk....', '...kfk...kfk....', '..kkk.....kkk...',
    ],
  },
  // Blueprint Penguin: round head, orange beak, belly, clipboard.
  planner: {
    m: [
      '...kkkkkk...', '..kffffffk..', '.kfeeffeefk.', '.kfeeffeefk.', '..kffooffk..', '..kkkkkkkk..',
      '.kfwwwfk.bbb', '.kfwwwfk.bwb', '.kfwwwfk.bdb', '.kffffk..bbb', '..kkkkk.....', '..oo..oo....',
    ],
    l: [
      '.....kkkkkk.....', '....kffffffk....', '...kffffffffk...', '...kfeeffeefk...', '...kfeeffeefk...', '...kfffooffffk..',
      '....kffffffk....', '....kkkkkkkk....', '..kfwwwwfk..ss..', '..kfwwwwfk.bwwb.', '..kfwwwwfk.bddb.', '..kfwwwwfk.bwwb.',
      '..kfwwwwfk.bddb.', '..kffffffk.bbbb.', '...kkkkkkkk.....', '...oo....oo.....',
    ],
  },
  // Nitpick Bat: batty ears, glasses, red pen.
  'completeness-critic': {
    m: [
      '.kk......kk.', '.kfk....kfk.', '.kffkkkkffk.', '.kddddddddk.', '.kdwddddwdk.', '.kddddddddk.',
      '..kffwwffk..', '...kkkkkk...', '.kfffffk.rr.', '.kfwwwfk.rr.', '.kfffffk.rr.', '.kkkkkkk.dd.',
    ],
    l: [
      '..kk........kk..', '..kfk......kfk..', '..kffk....kffk..', '...kffkkkkffk...', '..kffffffffffk..', '..kfddddddddfk..',
      '..kfdwwddwwdfk..', '..kfdweddewdfk..', '..kfddddddddfk..', '...kffwffwffk...', '....kkkkkkkk....', '...kffffffk.rr..',
      '...kfwwwwfk.rr..', '...kfwwwwfk.rr..', '...kffffffk.rr..', '...kkkkkkkk.dd..',
    ],
  },
};
