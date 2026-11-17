import type { Pools } from './types'

/** Idle talk, proposals and greetings. One line per template; see types.ts for slots. */
export const IDLE: Pools = {
  'idle.musing': {
    any: [
      'I have been driving in a circle for some time and I regret nothing.',
      'If anyone needs me, I will be here, being a vehicle.',
      'Do you ever park and just think about torque?',
      'I keep a list of everything I have bumped into. It is getting long and very specific.',
      'Somewhere on this planet there is a perfect parking spot. I will find it.',
      'Nothing is happening and I am thriving.',
      'I would describe my mood as [gently idling|mostly suspension|calm, with gravel].',
      'I named a rock earlier. I will not be telling anyone what.',
      'My wheels are dusty in a way that feels earned.',
      'I have a strong opinion about hills and I am keeping it to myself.',
      'This is my thinking pace. It is also my top speed.',
      'Quiet out here. Suspiciously pleasant.',
      'I have decided that the next hill is my favourite. Retroactively.',
      'Every so often I honk at nothing, just to keep the planet honest.',
    ],
    inspector: [
      'Bolt count is holding at [four hundred and twelve|three hundred and nine|six hundred and one]. I will check again in a minute.',
      'Everything looks fine, which is exactly what worries me.',
      'I have graded the general atmosphere {@hazard}.',
      'Could everyone just drive a little slower, in principle, forever?',
      'I counted one extra bolt this morning. I do not know where it came from. I am not sleeping.',
    ],
    clerk: [
      'I have filed this afternoon under {@form}.',
      'Under {@reg}, idling is permitted provided one looks busy. I am looking busy.',
      'Another lovely day of dust. Collected, sorted, stamped.',
      'Someone has to keep the paperwork on this planet, and that someone has a stamp.',
      'I have a drawer for everything. I am building a drawer for the drawers.',
    ],
    pilot: [
      'Not to brag, but {@academy}.',
      'They call me the spare pilot because I am spare. Spare talent, I assume.',
      'If the main pilot ever needs me, I am ready. I have been ready for years.',
      'I could fly this planet with my eyes closed. I have not been asked to. Yet.',
      'Fun fact: {@academy}.',
    ],
    probe: [
      'I had {@snack} earlier and I am still thinking about it.',
      'This part of the planet tastes {@flavour}. Nine out of ten.',
      'I am a little peckish. That is not news. That is just me.',
      'I hope everyone has eaten. Has everyone eaten? Somebody eat something.',
      'If I could have any snack right now it would be {@snack}. Or two of {@snack}.',
    ],
    marshal: [
      'Quiet.',
      'All clear. For now.',
      'This area could use {@cone}.',
      'Cone count: adequate.',
      'Standing by. With cones.',
    ],
    moon: [
      'I have been watching the moon. It has been watching back. Neither of us blinked.',
      'Reminder: {@conspiracy}.',
      'I am a moon in training. I am not like the other moons.',
      'I do not trust anything that only shows one side of itself.',
      'Some say {@conspiracy}. I say it louder.',
    ],
    auditor: [
      'Found {@rock} earlier. Graded it an A. Not saying it was the best A.',
      'Rust levels on this planet are [respectable|tasteful|frankly gorgeous].',
      'I like a rock that knows what it is.',
      'Nothing to audit here. Just sitting with my feelings about {@rock}.',
      'If you ever see {@rock}, tell it I said hello.',
    ],
    intern: [
      'Day [three|four|nine|eleven] of the internship. Still thrilled.',
      'I am learning so much just by sitting here.',
      'Does anyone have feedback on how I am idling? Honest feedback?',
      'I wrote down everything that happened today. It was mostly me idling.',
      'I am so grateful for this opportunity to be parked.',
    ],
  },

  'idle.planet': {
    any: [
      'Good planet, this. Very {planet}. Lots of it.',
      'A {planet} planet with a {sea} sea. Somebody planned this, and I want their number.',
      'I like how this planet commits to being {planet}.',
      'Every time I think I have seen all of this planet, it goes round again.',
      'The {sea} looks calm today. Let us all keep it that way.',
      'Small planet. You can see the curve if you squint and believe.',
    ],
    inspector: [
      'A {sea} sea is {@hazard}. I have put it in my report. Twice.',
      'This planet is round, which means every road is a slope somewhere.',
      'The whole planet is {planet}. I cannot grade it all. I have tried.',
    ],
    clerk: [
      'This planet is filed as {planet}, with {sea}. Correctly, for once.',
      'Under {@reg}, a {sea} sea must be kept on the outside of the planet.',
      'I have requested a second planet for comparison. It is pending.',
    ],
    pilot: [
      'I once landed on a planet much more {planet} than this. Nobody saw it.',
      'Easy planet. Mind you, {@academy}.',
      'Give me a {sea} sea and a run-up and I will show you something.',
    ],
    probe: [
      'This {planet} planet tastes {@flavour}, if you are wondering.',
      'A {sea} sea. I would not dip anything in it, but I respect it.',
      'If this planet were a snack it would be {@snack}. High praise.',
    ],
    marshal: [
      '{planet}. Noted.',
      'Whole planet. No cones. Concerning.',
      'The {sea} stays there. We stay here. Simple.',
    ],
    moon: [
      'This planet has a moon. I am not saying I trust it.',
      'Who decided this planet should be {planet}? Follow the craters.',
      'A {sea} sea and a moon overhead. Coincidence? Probably. But still.',
    ],
    auditor: [
      'A {planet} planet. The rocks here are carrying the whole place.',
      'I audited the {planet} bits. Rust: tasteful. Basalt: excellent.',
      'Underneath all this {planet} is {@rock}. I can feel it.',
    ],
    intern: [
      'My first {planet} planet! Is it always this {planet}?',
      'I did not know a sea could be {sea}. I am learning so much.',
      'If anyone has notes on how to appreciate a planet better, I am ready.',
    ],
  },

  'idle.sky': {
    any: [
      'Nice sky today. Very sky.',
      'The clouds are doing their best.',
      'Look at {@sky}. Just look at it.',
      'Somebody painted that horizon and did not sign it.',
      'The sun is out and so am I.',
    ],
    inspector: [
      'I have graded {@sky} {@hazard}. It is a long way up.',
      'Nothing up there has bolts. I find that unacceptable.',
    ],
    clerk: [
      'The sky has no permit. I have written to it.',
      'Clouds are dust that got ideas. I file them regardless.',
    ],
    pilot: [
      'That sky is my office. On days when I am allowed in it.',
      'I could be up there right now. I am choosing not to.',
    ],
    probe: [
      'That cloud looks like {@snack}. I am not well.',
      'If the sky had a flavour it would be {@flavour}.',
    ],
    marshal: [
      'Sky. Still there.',
      'Cannot cone the sky. Have tried.',
    ],
    moon: [
      'Do not look directly at {@sky}. That is what it wants.',
      'The sky is a lid. I will not be explaining further.',
      'Every cloud up there is covering for the moon.',
      'Lovely sky, if you do not think about who put it there.',
    ],
    auditor: [
      'Lovely sky. Nothing to grade up there. Shame.',
      'Clouds are just rocks that gave up. I say that with love.',
    ],
    intern: [
      'Is it normal to feel this inspired by a sky? Asking for feedback.',
      'I have never seen {@sky} from here before. I have only been here a day.',
    ],
  },

  'idle.night': {
    any: [
      'Dark now. Headlights on, everyone, and feelings off.',
      'Night drives are the same as day drives with more guessing.',
      'The stars are out. Show-offs.',
      'It is late. I am not tired. I am a vehicle.',
      'Very quiet tonight. I can hear my own tyres think.',
    ],
    inspector: [
      'Visibility down, hazards up. Bolt count by touch: approximately fine.',
      'Night is {@hazard} on its own. Please, slowly.',
    ],
    clerk: [
      'Night shift. Dust looks the same, but it files quieter.',
      'Under {@reg}, darkness is a temporary condition and will be reviewed.',
    ],
    pilot: [
      'At the academy we did night flying. I did night sitting, but nearby.',
      'I see perfectly in the dark. That bump was planned.',
    ],
    probe: [
      'Midnight snack time, technically. I would love {@snack}.',
      'The dark tastes {@flavour}. I licked it. Figuratively.',
    ],
    marshal: [
      'Night. Cones are harder to see. Respect them anyway.',
      'Dark. Stay in lane.',
    ],
    moon: [
      'It is night, which means the moon is on shift. I am watching it watch us.',
      'Night is the moon pretending it runs things.',
    ],
    auditor: [
      'Cannot grade rocks in the dark. Graded one anyway. Felt like a B plus.',
      'Basalt looks the same at night. That is why I trust it.',
    ],
    intern: [
      'My first night shift! Should I be doing something? Am I doing it?',
      'I am learning that night is darker than day. Big week for me.',
    ],
  },

  'idle.reply': {
    any: [
      'I will be thinking about that for the rest of the drive, {you}. Possibly longer.',
      '{you}, that is either very deep or a pothole.',
      'You say that every time, {you}, and every time it lands.',
      'Strong opinion, {you}. I am going to sit with it.',
      '{you}, that is either very wise or you have been in the sun.',
      'Noted, {you}. Filed under thoughts.',
      'I was thinking the exact same thing, {you}, but worse.',
    ],
    inspector: [
      '{you}, please say that more slowly. I want to check it for loose bits.',
      'That remark is {@hazard}, {you}, but I will allow it.',
    ],
    clerk: [
      'I will need that in writing, {you}. {@form}.',
      'Under {@reg}, {you}, that counts as a musing. Stamped.',
    ],
    pilot: [
      'Ha. {you}, {@academy}.',
      'I had that exact thought at the academy, {you}, but faster.',
    ],
    probe: [
      'That is lovely, {you}. Have you eaten?',
      '{you}, that thought was {@flavour}. Truly.',
    ],
    marshal: [
      'Sure, {you}.',
      'Copy, {you}.',
      'Needs a cone, {you}.',
    ],
    moon: [
      'That is what they want you to think, {you}.',
      '{you}, has the moon heard you say that?',
    ],
    auditor: [
      'Very true, {you}. Reminds me of {@rock}.',
      'I would grade that thought a solid B, {you}. Like gneiss.',
    ],
    intern: [
      'Wow, {you}. Can I write that down?',
      '{you}, I am learning so much from you right now.',
    ],
  },

  'propose.tag': {
    any: [
      'Anyone for tag? I will be it. I am usually it.',
      '{you}, tag. You are it. No, wait, I have to touch you first. Hold still.',
      'Game of tag? Gentle contact only. Bumpers out.',
      'Tag, {you}? Best of three, loser compliments the winner.',
    ],
    inspector: [
      'Tag, {you}? With a maximum speed of slowly, and no touching above the axles?',
      'I would like to propose a very safe game of tag. Think of it as a drill.',
    ],
    clerk: [
      'I propose tag, {you}, per {@form}. Initial here.',
      'Tag is permitted under {@reg}. Shall we, {you}?',
    ],
    pilot: [
      'Tag, {you}? You will not catch me. Statistically you might. Do not.',
      'I was tag champion at the academy. Second place. Of two.',
    ],
    probe: [
      'Tag, {you}? Winner gets a snack. Loser also gets a snack.',
      'Would anyone like to play tag? I promise to be kind about it.',
    ],
    marshal: ['Tag. {you}. Now.', 'Tag, {you}. The cone is home base. Do not touch the cone.'],
    moon: [
      'Tag, {you}. Whoever is it has to look at the moon.',
      'Let us play tag. The moon thinks it is always it. Prove it wrong.',
    ],
    auditor: [
      'Tag, {you}? Base is that lovely bit of basalt over there.',
      'Quick game of tag, then I have rocks to see.',
    ],
    intern: [
      'Tag, {you}? I have never played! I have read about it!',
      'Would anyone play tag with me? I would love feedback on my running.',
    ],
  },

  'propose.race': {
    any: [
      'Race you, {you}. To that thing. You know the thing.',
      'Fancy a race, {you}? Winner gets bragging rights and nothing else.',
      'Race to the far hill? Last one there has to be nice about it.',
      '{you}, race? I will give you a head start out of guilt.',
    ],
    inspector: [
      'A race, {you}, but a slow one? A walking race? For vehicles?',
      'I propose a race with a speed limit. First to arrive calmly wins.',
    ],
    clerk: [
      'Race, {you}? I have pre-filled {@form}. Winner keeps the stamp.',
      'Under {@reg}, a race requires two participants. You are one, {you}.',
    ],
    pilot: [
      'Race, {you}? Fair warning, {@academy}.',
      'Race me, {you}. I will win, or I will have been letting you.',
      'Last one to the ridge is the spare pilot. Wait. No.',
    ],
    probe: [
      'Race to the ridge, {you}? I packed {@snack} for the finish.',
      'A race! I will cheer for whoever is losing, including me.',
    ],
    marshal: ['Race. I will place cones.', 'Race, {you}. Clean line.'],
    moon: [
      'Race you to the horizon, {you}, before the moon sees where we are going.',
      'Race? Fine. If we go fast enough the moon cannot keep up.',
    ],
    auditor: [
      'Race to the ridge, {you}? I may stop for a rock. Do not wait.',
      'Race you there. Winner gets to name a pebble.',
    ],
    intern: [
      'Race, {you}? Please do not let me win, I want to earn it!',
      'Can we race? I would love to know my weaknesses. All of them.',
    ],
  },

  'propose.explore': {
    any: [
      'Want to go and look at things, {you}? Any things.',
      'Explore with me, {you}? I have a feeling about over there.',
      'Let us drive somewhere we have not been and pretend we meant to.',
      '{you}, adventure? Small one. Back before dark.',
    ],
    inspector: [
      'Exploring, {you}? I will go first and grade everything.',
      'I would like to propose a careful survey. With stops. Many stops.',
    ],
    clerk: [
      'Explore, {you}? I need an itinerary on {@form}. I have one here.',
      'Shall we survey the unfiled parts, {you}? There are so many.',
    ],
    pilot: [
      'Follow me, {you}. I know the way. I know a way.',
      'Exploring? I have explored so much already. Some of it was here.',
    ],
    probe: [
      'Explore, {you}? Somewhere out there is a rock that tastes {@flavour}.',
      'Let us go and find a nice spot for a snack, {you}.',
    ],
    marshal: ['Explore. Stay together. I lead.', 'Out there, {you}. Bring a cone.'],
    moon: [
      'Explore with me, {you}. I want to find where the moon goes when we are not looking.',
      'Let us look around. Quietly. It is listening.',
    ],
    auditor: [
      'Explore, {you}? I heard a rumour about {@rock} over the ridge.',
      'Rock walk, {you}? Only takes three hours. Per rock.',
    ],
    intern: [
      'Explore, {you}? I have never explored anything! Except this sentence!',
      'Can I come exploring? I will carry things. I cannot carry things. I will try.',
    ],
  },

  'propose.summit': {
    any: [
      'Summit, {you}? The view up there is meant to be ridiculous.',
      'Who is up for the top? I want to look down at things.',
      'Climb to the summit, {you}? We will feel very tall.',
      '{you}, the summit. Today. Probably today.',
    ],
    inspector: [
      'The summit, {you}? It is {@hazard}. I will come. To supervise.',
      'Summit trip, but in first gear the whole way?',
    ],
    clerk: [
      'Summit, {you}? Altitude above a certain height requires {@form}.',
      'Let us climb. I will file the view on arrival.',
    ],
    pilot: [
      'Summit, {you}? I have done it a hundred times. In simulation.',
      'Race you up the summit. I will take the hard way. On purpose.',
    ],
    probe: [
      'Picnic at the summit, {you}? I have {@snack}.',
      'They say summit air tastes {@flavour}. I need to know.',
    ],
    marshal: ['Summit. Single file.', 'Up we go, {you}. Cones at the top.'],
    moon: [
      'Summit, {you}? Closer to the moon. Good. I have things to say to it.',
      'Let us go up and get a better look at the sky. It needs supervising.',
    ],
    auditor: [
      'Summit, {you}? The rocks at the top are the old money of rocks.',
      'Up there is {@rock}. I can feel it from here.',
    ],
    intern: [
      'The summit? With me? That would mean so much, {you}.',
      'I have never been on a summit. Is it like a hill but more?',
    ],
  },

  'propose.convoy': {
    any: [
      'Convoy, {you}? We drive in a line and look extremely official.',
      'Everyone line up. We are a convoy now. Act like it.',
      'Let us all go somewhere together and not tell anyone where.',
      '{you}, convoy? I will be the bit in the middle.',
    ],
    inspector: [
      'Convoy, {you}? Two vehicle lengths apart, please. Three if you love me.',
      'I propose a convoy. Safety in numbers. I have counted the numbers.',
    ],
    clerk: [
      'A convoy needs a manifest, {you}. Name, vehicle, mood.',
      'Convoy formation under {@reg}. Fall in.',
    ],
    pilot: [
      'Convoy, {you}? I will lead. Unless someone else leads. Then I will be the spare leader.',
      'Follow me in a line. At the academy I was the line.',
    ],
    probe: [
      'Convoy, {you}? Like a packed lunch, but of vehicles.',
      'Let us all go together. Nobody gets left without a snack.',
    ],
    marshal: ['Convoy. Behind me. Go.', 'Form up, {you}.'],
    moon: [
      'Convoy, {you}? Together we are harder to track from orbit.',
      'Let us move as a group. The moon cannot follow everyone.',
    ],
    auditor: [
      'Convoy, {you}? Fine, but we are stopping at every interesting rock.',
      'A rock-tour convoy. Nine stops. Ten if the gneiss is good.',
    ],
    intern: [
      'A convoy! Can I be in it? Am I in it? Am I doing it right?',
      'Convoy, {you}? I will follow so closely. Not too closely. Feedback welcome.',
    ],
  },

  'reply.accept': {
    any: [
      'Go on then, {you}.',
      'Yes. Absolutely. I had nothing on.',
      'You had me at the first word, {you}.',
      'Fine. But I am having fun under protest.',
      'Lead the way, {you}.',
    ],
    inspector: [
      'Yes, {you}, but I am bringing the checklist.',
      'All right. I will count bolts on the way. Mine and yours.',
    ],
    clerk: [
      'Approved, {you}. Stamped. Off we go.',
      'Accepted under {@reg}. One moment while I find the stamp.',
    ],
    pilot: [
      'Obviously, {you}. I was born ready. Assembled ready.',
      'Yes. Try to keep up. Or do not, I am fine either way.',
    ],
    probe: [
      'Oh, yes please, {you}! I will bring {@snack}.',
      'I would love that. Thank you for asking me.',
    ],
    marshal: ['Yes.', 'Fine.', 'On it.'],
    moon: [
      'Yes, {you}. But if the moon asks, I was never here.',
      'Agreed. Act natural.',
    ],
    auditor: [
      'Yes, {you}. One moment, I am putting this rock back.',
      'Agreed. I will grade the route as we go.',
    ],
    intern: [
      'Yes! Yes yes. Thank you for including me, {you}.',
      'Absolutely! Can you tell me how I did afterwards?',
    ],
  },

  'reply.refuse': {
    any: [
      'I am going to say no, {you}, but with warmth.',
      'Not today, {you}. Today I am a stationary object.',
      'Tempting. No.',
      'I would love to, {you}, which is why I must decline.',
      'Ask me again later and I will say no again, but closer.',
    ],
    inspector: [
      'Sorry, {you}. That is {@hazard}. I have done the paperwork.',
      'No. I have not finished counting from this morning.',
    ],
    clerk: [
      'Denied, {you}. {@form} was not filed.',
      'Under {@reg}, I am on a break. It is the long break.',
    ],
    pilot: [
      'I would, {you}, but I would win and it would be awkward.',
      'Not right now. I am resting my reflexes. They are very good.',
    ],
    probe: [
      'Oh, I am so sorry, {you}. I just started {@snack}.',
      'Not now, but thank you. Truly. Next time.',
    ],
    marshal: ['No.', 'Negative.', 'Not today.'],
    moon: [
      'No, {you}. That is exactly what the moon would want.',
      'I cannot. I am being watched. Not by you.',
    ],
    auditor: [
      'Sorry, {you}. I am mid-audit. This rock will not grade itself.',
      'Not now, {you}. I am in a relationship with {@rock}.',
    ],
    intern: [
      'Oh no, I would love to, but I have been told to stay here. By myself, but still.',
      'I have to say no, {you}, and I feel terrible. Was that a good no?',
    ],
  },

  'reply.haggle': {
    any: [
      'Yes, but I choose the music. There is no music. I choose the silence.',
      'Deal, {you}, if we stop at the first interesting rock. And the second.',
      'Yes, {you}, if I get to choose the music.',
      'Only if we take the scenic route.',
      'Deal, if you go first, {you}.',
      'Yes, on the condition that nobody brings up last time.',
    ],
    inspector: [
      'Yes, {you}, at half the speed you were thinking.',
      'If you let me check your bolts first. All of them.',
    ],
    clerk: [
      'Yes, {you}, subject to {@form}. In triplicate.',
      'Agreed, pending review under {@reg}. Review complete. Agreed.',
    ],
    pilot: [
      'Fine, {you}, but I am telling everyone I won.',
      'Yes, if I can tell you about the academy on the way.',
    ],
    probe: [
      'Yes, {you}, if we stop for {@snack} on the way.',
      'Of course, if there is time for a little taste of the scenery.',
    ],
    marshal: ['Yes. With cones.', 'Fine. I set the cones.'],
    moon: [
      'Yes, {you}, but we go the way the moon cannot see.',
      'Fine, if we stay under the clouds.',
    ],
    auditor: [
      'Yes, {you}, but I am stopping for any basalt. Any basalt.',
      'Agreed, if I get first look at {@rock}.',
    ],
    intern: [
      'Yes! Can I get feedback after? Written, if possible.',
      'Yes, {you}, if you show me how. I want to learn.',
    ],
  },

  'reply.busy': {
    any: [
      'I am in the middle of something, {you}.',
      'Can it wait, {you}? I am {activity}.',
      'Bit busy, {you}. Very much {activity}.',
      'Sorry, I am {activity} and I have momentum.',
      'Give me a moment, {you}. I am deep into {activity}.',
    ],
    inspector: [
      'Cannot, {you}. I am on bolt two hundred and something.',
      'I am {activity}, {you}, and doing it safely takes ages.',
    ],
    clerk: [
      'One moment, {you}. I am {activity}, which needs its own form.',
      'Busy, {you}. Filing. It is always filing.',
    ],
    pilot: [
      'Kind of busy, {you}. I am {activity}. Professionally.',
      'Not now, {you}. I am rehearsing a landing.',
    ],
    probe: [
      'Busy, {you}, sorry! I am {activity} and also snacking.',
      'Just finishing {@snack}, {you}. Then I am all yours.',
    ],
    marshal: ['Busy.', 'Busy. Carry on.'],
    moon: [
      'Busy, {you}. I am keeping an eye on the sky. Both eyes.',
      'I am {activity}, {you}. It is a cover.',
    ],
    auditor: [
      'Busy, {you}. I am auditing a pebble.',
      'One moment, {you}. I have {@rock} under review.',
    ],
    intern: [
      'I am {activity}, {you}! Is that okay? I can stop. Should I stop?',
      'Sorry, busy! I was told to keep at it. I think I was told that.',
    ],
  },

  'retort.busy': {
    any: [
      'You are {activity}, {you}. That is not a thing. That is a vibe.',
      'Busy {activity}? I have seen you {activity}. It is mostly sitting.',
      'You have been {activity} for an hour, {you}.',
      'Ah yes, {activity}. The classic excuse.',
      'You are in the middle of a puddle, {you}.',
    ],
    inspector: [
      'You are {activity} at an unsafe level of commitment, {you}.',
      'Very well. I will grade your excuse {@hazard}.',
    ],
    clerk: [
      'Under {@reg}, {activity} is not a valid excuse. I checked.',
      'I will file that under Excuses, {you}. It is a big drawer.',
    ],
    pilot: [
      'At the academy we called {activity} giving up, {you}.',
      'Fine, {you}. More glory for me.',
    ],
    probe: [
      'That is all right, {you}. I will save you {@snack}.',
      'Oh, {activity} sounds lovely, actually. Carry on.',
    ],
    marshal: ['Sure.', 'Noted. Cone placed.', 'Busy. Right.'],
    moon: [
      'Busy {activity}. That is just what the moon says.',
      'You and your {activity}, {you}. Very convenient.',
    ],
    auditor: [
      'Busy? I once spent a week with one rock and still made time.',
      'Fine, {you}. The basalt and I will go alone.',
    ],
    intern: [
      'Oh, that is completely fine, {you}! What does {activity} involve? Can I watch?',
      'Understood! I am learning that people are busy.',
    ],
  },

  'payoff.accepted': {
    any: [
      'Right. Off we go then.',
      'Good. This is happening.',
      'Excellent. Nobody tell the others.',
      'Lovely. Try not to make it a story.',
      'Then it is settled. Wheels on.',
    ],
    inspector: ['Wonderful. Please wait while I recount everything.', 'Great. Helmets on. Metaphorically.'],
    clerk: ['Stamped and approved. Proceed.', 'Filed under {@form}. Go.'],
    pilot: ['Watch and learn. Mostly watch.', 'Follow my lead. Like at the academy, but better.'],
    probe: ['Yay. I am so happy we are doing this.', 'Lovely. I will bring {@snack}.'],
    marshal: ['Go.', 'Moving.'],
    moon: ['Good. Quickly, before it notices.', 'Excellent. Do not look up.'],
    auditor: ['Perfect. I will grade the experience.', 'Off we go. Keep an eye out for {@rock}.'],
    intern: ['Yay! I will take notes!', 'This is the best day of my internship. Again.'],
  },

  'payoff.refused': {
    any: [
      'Your loss, {you}. I will describe it to you later in unnecessary detail.',
      'Understood. I will have a wonderful time, slightly to your left.',
      'Fine. I am taking the fun with me. All of it. It fits in the boot.',
      'Fair enough. More fun for nobody.',
      'Your loss, {you}. A small loss. Medium.',
      'Fine. I will do it alone and describe it at length.',
      'All right. The offer stands. Over there. Alone.',
    ],
    inspector: ['Probably for the best. I was already nervous.', 'That is fine. Safer, really.'],
    clerk: ['Request withdrawn. Stamped. Sad stamp.', 'I will file your refusal under {@reg}.'],
    pilot: ['Fine. You would have lost anyway.', 'I meant for you to say no. Plan B.'],
    probe: ['Oh, that is all right. I will eat the snacks myself. With love.', 'No worries, {you}. Next time!'],
    marshal: ['Copy.', 'Fine.'],
    moon: ['I understand. They got to you too.', 'Suit yourself. The moon wins this round.'],
    auditor: ['Fair. The rocks and I will manage.', 'All right. More basalt for me.'],
    intern: ['Totally fine! Can I ask what I could have done better?', 'Okay! I am learning about rejection!'],
  },

  'meet.hello': {
    any: [
      'Hello, {you}.',
      'Oh, hello, {you}. Fancy seeing you on the only planet.',
      '{you}! Just the vehicle I was hoping to see. Or a vehicle.',
      'Afternoon, {you}. Is it afternoon? Hello anyway.',
      'There you are, {you}. Where were you? Do not tell me.',
    ],
    inspector: ['Hello, {you}. Your bolts look good. I counted. Sorry.', 'Hi, {you}. Please approach slowly.'],
    clerk: ['Good day, {you}. Please sign in.', 'Ah, {you}. Your greeting is noted under {@reg}.'],
    pilot: ['{you}! Did you see that? You did not. It was great.', 'Hey, {you}. Spare pilot, at your service.'],
    probe: ['Hello, {you}! Have you eaten?', 'Hi, {you}! You look well fuelled.'],
    marshal: ['{you}.', 'Hello, {you}.'],
    moon: ['{you}. Were you followed?', 'Hello, {you}. Keep your voice down.'],
    auditor: ['Hello, {you}. Seen any good rocks?', 'Ah, {you}. Lovely rust on you today.'],
    intern: ['Hi {you}! Hello! Sorry, hello!', '{you}! I have heard so much about you. From me.'],
  },

  'meet.reply': {
    any: [
      'Hello yourself, {you}.',
      'Oh, hi, {you}. I was just about to do nothing.',
      'Hey, {you}. Good timing. I am bored.',
      '{you}! Hello! Same planet!',
    ],
    inspector: ['Hello, {you}. Slowly, please. Hello.', 'Hi, {you}. You are within tolerance today.'],
    clerk: ['Good day, {you}. Greeting received and acknowledged.', 'Hello, {you}. Please take a number.'],
    pilot: ['{you}, hey. I was doing a cool thing a second ago.', 'Hello, {you}. I meant to be standing here.'],
    probe: ['Hi, {you}! I have {@snack} if you want some.', 'Hello! You look lovely today, {you}.'],
    marshal: ['Yep.', '{you}.'],
    moon: ['Hello, {you}. Act casual.', 'Hi, {you}. Did you see the moon on your way?'],
    auditor: ['Hello, {you}. I was just admiring {@rock}.', 'Hi, {you}. Mind the basalt.'],
    intern: ['Hi! Oh wow, hi, {you}!', 'Hello! Was that a good hello? I am practising.'],
  },

  'bot.arrive': {
    any: [
      'Oh, {subj} is here. Everyone look busy.',
      'Welcome, {subj}. The planet is round. That is the tour.',
      'Hello, {subj}. Pull up a hill.',
      '{subj} has arrived. Things just got [slightly|noticeably|marginally] more official.',
      'Ah, {subj}. Good. We needed another one of us.',
    ],
    inspector: ['Welcome, {subj}. Please proceed to the bolt check.', '{subj}, hello. Your landing was {@hazard}. Welcome.'],
    clerk: ['Welcome, {subj}. Please fill in {@form}.', '{subj} has arrived. I have logged it. Twice.'],
    pilot: ['{subj}! Watch me for tips.', 'Welcome, {subj}. Do not worry, I am here.'],
    probe: ['Welcome, {subj}! Have you eaten? There is ground everywhere.', 'Hi, {subj}! This area tastes {@flavour}.'],
    marshal: ['{subj}. Welcome. Stay in lane.', 'New arrival. Cone deployed.'],
    moon: ['{subj} arrived from the sky. Interesting. Very interesting.', 'Welcome, {subj}. Did the moon send you?'],
    auditor: ['Welcome, {subj}. There is {@rock} nearby, if you want to see it.', 'Ah, {subj}. Good rust on you.'],
    intern: ['{subj}! Hi! Welcome! I am the intern!', 'Welcome, {subj}! Can I show you around? I do not know it.'],
  },

  'bot.arrive.self': {
    any: [
      'Hello, everyone. I am {me}. I will be here, being around.',
      '{me} here. Do not get up.',
      'Hi. {me}. I have arrived, more or less in one piece.',
      'It is me, {me}. Please contain your excitement.',
    ],
    inspector: ['{me}, {role}. Everyone please stay exactly where you are.', 'Hello. {me}. I have already found {@hazard}.'],
    clerk: ['{me}, {role}, reporting. I have forms.', 'Hello. {me}. Please queue.'],
    pilot: ['{me}, {role}, has landed. That was on purpose.', 'The spare pilot is here. No need to thank me yet.'],
    probe: ['Hi! {me}! I am the {role}! Anyone hungry?', 'Hello, everyone. {me} here. This place smells {@flavour}.'],
    marshal: ['{me}. {role}. Here.', '{me}. On duty.'],
    moon: ['{me}. {role}. I know things.', '{me} here. The moon does not know I am here. Keep it that way.'],
    auditor: ['{me}, {role}. Show me your rocks.', 'Hello. {me}. I will be grading the scenery.'],
    intern: ['Hi! I am {me}, the {role}! It is my first day! Again!', 'Hello! {me}! So excited to learn from all of you!'],
  },

  'bot.gone': {
    any: [
      '{subj} has been reassigned to a nicer planet.',
      'Where did {subj} go? Probably somewhere with snacks.',
      'Has anyone seen {subj}? They were here, then they were not.',
      '{subj} has left. The planet is slightly lighter.',
      '{subj} went to find themselves. Or a car park.',
    ],
    inspector: ['{subj} has gone. I hope they took all their bolts.', 'No sign of {subj}. I will note it as a calm departure.'],
    clerk: ['{subj} has left without filing {@form}. Typical.', 'Departure of {subj} logged under {@reg}.'],
    pilot: ['{subj} left. Probably could not handle my driving.', 'Gone, {subj}? They will be back. They always come back to me.'],
    probe: ['Oh, {subj} has gone. I saved them {@snack}.', 'I hope {subj} has a lovely time wherever they are.'],
    marshal: ['{subj}. Gone.', '{subj} left. Cone remains.'],
    moon: ['{subj} has gone up. I knew it. I always knew.', '{subj} has been taken. Somewhere nice. Probably.'],
    auditor: ['{subj} is gone. Took a rock with them, I bet.', 'No more {subj}. The basalt misses them.'],
    intern: ['Is {subj} coming back? I did not get their feedback!', '{subj} left! Was it something I did? It is fine.'],
  },

  'time.sunrise': {
    any: [
      'Morning, everyone. Sun is up.',
      'Here comes the sun. Right on schedule.',
      'Sunrise. Free light. Lovely.',
      'Morning. The planet is turning, just like we discussed.',
    ],
    inspector: ['Sunrise. Visibility up. I can see all the hazards now. Wonderful.', 'Morning. Bolt check, everyone.'],
    clerk: ['Sunrise logged. On time, for once.', 'Under {@reg}, morning has officially begun.'],
    pilot: ['Sunrise. I like to think it came up for me.', 'Morning. I was up before the sun. Ask the sun.'],
    probe: ['Good morning! Breakfast! Who wants breakfast?', 'The light tastes {@flavour} this morning.'],
    marshal: ['Morning.', 'Sun up.'],
    moon: ['The sun is up. The moon is hiding. Classic.', 'Sunrise. The moon goes off shift. Where does it go?'],
    auditor: ['Morning light on basalt. Nothing better.', 'Sunrise. The rust really glows.'],
    intern: ['Good morning! A whole new day of learning!', 'Sunrise! My favourite! Everything is my favourite.'],
  },

  'time.sunset': {
    any: [
      'Sunset. Gorgeous. Somebody tell the sun well done.',
      'Here goes the sun. Bye.',
      'Look at that colour. Unreasonable.',
      'Evening, everyone. Lights on soon.',
    ],
    inspector: ['Sunset. Visibility decreasing. Please slow down. More than that.', 'Evening. Headlights, please.'],
    clerk: ['Sunset logged. The day is closed. No more entries.', 'Day concluded under {@reg}.'],
    pilot: ['Sunset. At the academy we raced it. I came second.', 'Nice sunset. I have seen better. From the air.'],
    probe: ['That sunset looks like {@snack}.', 'Dinner time! Is it? It feels like dinner time.'],
    marshal: ['Sunset.', 'Dark soon. Lights.'],
    moon: ['The sun is leaving and the moon is coming. I do not like this handover.', 'Sunset. Shift change. Watch closely.'],
    auditor: ['Sunset on the rocks. Grade A.', 'The light makes {@rock} look ten years younger.'],
    intern: ['That sunset was beautiful! Can I give it feedback? Ten out of ten.', 'Wow. I am learning so much about colours.'],
  },

  'time.night': {
    any: [
      'Night falls. Not literally. Mind your heads anyway.',
      'And that is the day done. On to night.',
      'Dark now. Stars, if anyone wants them.',
      'Night. A quiet planet in a quiet universe.',
    ],
    inspector: ['Night. All hazards are now invisible hazards.', 'It is dark. I have upgraded everything to {@hazard}.'],
    clerk: ['Night shift begins. The dust does not stop.', 'Night commences, per {@reg}.'],
    pilot: ['Night. Perfect for my night moves. I have some.', 'Dark. I am at my best in the dark. You cannot see me fail.'],
    probe: ['Night. Time for a little something. Toast, maybe.', 'It is dark and I am peckish. Is that a law?'],
    marshal: ['Night. Lights on.', 'Dark. Careful.'],
    moon: ['Night. It is up there now. Do not wave.', 'The moon is out. I am in. That is the arrangement.'],
    auditor: ['Night. I can hear the rocks cooling. Lovely sound.', 'Too dark to audit. I will audit by feel.'],
    intern: ['Is this night? It is so dark! Is it always this dark?', 'Night time! What do we do at night?'],
  },

  'weather.cloudy': {
    any: [
      'Clouds coming in. The sky has put a coat on.',
      'Bit cloudy. Moody. I respect it.',
      'Overcast. Good light for thinking.',
      'Clouds. The planet is having a quiet one.',
    ],
    inspector: ['Cloud cover: {@hazard}. Please drive accordingly.', 'Clouds. Reduced visibility. Increased me.'],
    clerk: ['Cloud cover logged. Unauthorised, but logged.', 'The clouds are in breach of {@reg}.'],
    pilot: ['Clouds? I can fly through those. I will not, but I can.', 'At the academy we called this weather practice.'],
    probe: ['Those clouds look like mashed potato.', 'Clouds! Like candyfloss. I want one.'],
    marshal: ['Cloudy.', 'Clouds. Still cones.'],
    moon: ['Clouds. Perfect cover for the moon to move around.', 'Why is it cloudy? Who benefits?'],
    auditor: ['Clouds make the rocks look moody. I love it.', 'Overcast. Basalt is at its most dramatic.'],
    intern: ['Clouds! I have never seen clouds! I have, but not these!', 'Is cloudy good? I want to react correctly.'],
  },

  'weather.clear': {
    any: [
      'Clouds gone. Sky is open.',
      'Clear skies. Someone has tidied up.',
      'Lovely and clear. You can see for miles. You can see us.',
      'Blue sky. Very unambitious, very pleasant.',
    ],
    inspector: ['Clear sky. Good visibility. Now there is no excuse to go fast.', 'Clear. All hazards visible. I see them all.'],
    clerk: ['Clear weather, approved under {@reg}.', 'Sky cleared. I have filed the clouds.'],
    pilot: ['Clear skies. The sky has seen me coming.', 'Perfect flying weather. For other people today.'],
    probe: ['Clear skies are refreshing, like a crisp.', 'Ah, clear and fresh. Like a nice cracker.'],
    marshal: ['Clear.', 'Sky clear. Road clear.'],
    moon: ['Clear sky. Nowhere to hide. Good. Neither has it.', 'Clouds gone. Very convenient for the moon.'],
    auditor: ['Clear sky, clear view of the ridge. Plenty of rocks.', 'Sun on the basalt. That is it, that is my mood.'],
    intern: ['The clouds left! Is that normal? It is lovely!', 'Clear skies! I hope I am doing them justice.'],
  },
}
