/**
 * What bots say when a player asks them for something in chat, and what they say while
 * doing it (or not). Slots and content rules are in types.ts.
 */
import type { Pools } from './types'

export const REQUESTS: Pools = {
  'req.accept.follow': {
    any: [
      "Following you, {player}. Lead somewhere with a view.",
      "On your tail, {player}. Politely. At a respectful distance.",
      "Right behind you. If you stop suddenly, that is on both of us.",
      "Following. I have no idea where we are going and I have never felt more free.",
      "Yes. Lead on, {player}. I will copy your turns and none of your confidence.",
      "Following you. If anyone asks, this was my idea.",
    ],
    inspector: [
      "Following, {player}. Two vehicle lengths. Three if you do the thing where you jump.",
      "I will follow. I have pre-graded every hazard between here and anywhere. Mostly amber.",
      "Following you at a speed I would describe as responsible and you would describe as reversing.",
    ],
    clerk: [
      "Following request received, logged and approved. You may now be followed.",
      "I will follow, {player}. Retroactive paperwork to follow, also following.",
      "Following you under {@reg}, the one about being nice to drivers.",
    ],
    pilot: [
      "Following you, {player}. Technically I am leading from behind. Academy move.",
      "Sure, I will follow. Gives you the experience of being ahead of me, which is rare.",
      "Following. Try not to lose me. I mean that as a warning for you, not a worry for me.",
    ],
    probe: [
      "Following you, {player}! If you pass anything edible, slow down a little.",
      "Yes please. I like following people. It is like a snack trail but the snack is company.",
    ],
    marshal: [
      "Following.",
      "On you, {player}. Lead. I will handle the cones.",
      "Following. I do not leave. Remember that.",
    ],
    moon: [
      "Following you. Also following the moon, which is following us. Act natural.",
      "Fine. I will follow you, but only because the moon expects me not to.",
    ],
    auditor: [
      "Following, {player}. If I stop, it is a rock. Do not wait. Actually, please wait.",
      "I will follow, provided the route has some geology on it. Any geology.",
    ],
    intern: [
      "Following you! This is my first following! Well, my fourth. Every one feels like the first!",
      "Yes! Following! Rate my following at the end? Out of ten? Be honest. Be generous.",
      "On it, {player}! I am taking notes on your turns. Mostly they say: wow.",
    ],
  },

  'req.accept.come': {
    any: [
      "Coming, {player}.",
      "On my way. Do not move, I have only just found you.",
      "Coming over. Keep doing the interesting thing you are doing over there.",
      "Heading to you now. Estimated arrival: soon, with a scenic detour I will deny.",
      "Coming. Leave the light on.",
    ],
    inspector: [
      "Coming, {player}. Carefully. I have counted the bolts and they are all here, for now.",
      "On my way at a sensible speed. You will see me in a while. You may see me for a long while first.",
    ],
    clerk: [
      "Approaching you now. Please remain at your current location until I have been there.",
      "Coming over. This counts as a site visit and will be minuted.",
    ],
    pilot: [
      "Coming in hot, {player}. Well. Warm. Lukewarm. Coming in.",
      "On my way. Watch the landing, it is going to be textbook. Some textbook.",
    ],
    probe: [
      "Coming! Is it food? It is fine if it is not food. Is it food, though?",
      "On my way, {player}! I brought nothing but I am bringing myself, which is something.",
    ],
    marshal: [
      "Coming.",
      "Inbound. Stay put.",
    ],
    moon: [
      "Coming. Keep your voice down. Things up there can hear chat.",
      "On my way, by a route the moon cannot predict. It is the normal route, but backwards.",
    ],
    auditor: [
      "Coming, {player}. There is a pebble between us I may need to discuss on the way.",
      "One moment, there is an outcrop. Fine. Coming. Fine.",
    ],
    intern: [
      "Coming! Sprinting! Well, driving, but in the spirit of a sprint!",
      "On my way, {player}! Thank you for thinking of me! You thought of me!",
    ],
  },

  'req.accept.stop': {
    any: [
      "Holding here. I will just stand very still and look purposeful.",
      "Waiting, {player}. I am excellent at this. It is most of what I do.",
      "Parked. Take your time. I have nowhere to be, which is a bit sad when I say it out loud.",
      "Waiting here. If I start to drift, that is the planet, not me.",
    ],
    inspector: [
      "Stopping! Thank you. Finally. Someone asked me to stop. This is the best day.",
      "Holding position. Brakes applied, checked, rechecked. Brakes are fine. Thank you for asking.",
    ],
    clerk: [
      "Halting. Please note I have halted at {player}'s request and not of my own free will.",
      "Waiting. I will use the time to fill in {@form}, which is the form for waiting.",
    ],
    pilot: [
      "Stopping. Not because I need to. I just want you to see me stop. Look at that stop.",
      "Holding. I was about to stop anyway. Timing is everything, the Academy said.",
    ],
    probe: [
      "Waiting! I will have a little snack while I wait. I have no snack. I will imagine one.",
      "Stopped, {player}. Take as long as you like. I like waiting with people.",
    ],
    marshal: [
      "Holding.",
      "Stopped. I will put a cone down. I do not have a cone. Imagine the cone.",
      "Waiting. As long as it takes.",
    ],
    moon: [
      "Stopping. Good. A moving target is easier for the moon to follow. Wait, is it the other way round?",
      "Holding still. The moon cannot stand it when you hold still. It has to do all the work.",
    ],
    auditor: [
      "Stopping. Oh good, there is a rock here. I would have stopped anyway, honestly.",
      "Holding. While we wait I will grade this gravel. Early read: confident gravel.",
    ],
    intern: [
      "Stopped! Was that a good stop? Did I stop well? I want to be a great stopper.",
      "Waiting, {player}! I am standing by! I am the most standing-by I have ever been!",
    ],
  },

  'req.accept.scatter': {
    any: [
      "Going. I can take a hint. I can take quite a lot of hints, it turns out.",
      "Off I go. Have fun, {player}. Without me. Which is allowed.",
      "Giving you some room. Lots of room. A planet's worth.",
      "Leaving. I will be over there being fine about it.",
      "Fair. Peeling off. I was never here. I was a bit here.",
    ],
    inspector: [
      "Going, {player}. Space between vehicles is the safest thing, so in a way this is a compliment.",
      "Moving off. I will grade this conversation an amber. That is not a complaint. It is a grade.",
    ],
    clerk: [
      "Understood. I will file myself elsewhere.",
      "Departing. Your request has been stamped Received, Regretted and Respected.",
    ],
    pilot: [
      "Going. I had somewhere better to be anyway. I will find out where on the way.",
      "Sure. Off I go. Not because you asked. I just remembered a thing. A cool thing.",
    ],
    probe: [
      "Okay! I will go. You are still lovely. I will think of you when I find a snack.",
      "Going, {player}. Take care of yourself. Eat something.",
    ],
    marshal: [
      "Going. Not far.",
      "Leaving. If you need me, I am within shouting range. I checked.",
    ],
    moon: [
      "Going. Somewhere the moon cannot see. So, a cave, probably. For a while.",
      "Fine. That is exactly what the moon would want you to say. Going anyway.",
    ],
    auditor: [
      "Going. There is a seam of something over there I have been meaning to look at.",
      "Off I go. Rocks never ask me to leave. I am not saying anything. I am saying something.",
    ],
    intern: [
      "Going! Thank you for the feedback! It was very clear feedback!",
      "Off I go, {player}! I am learning about boundaries! This is a boundary! Wow!",
    ],
  },

  'req.accept.chase': {
    any: [
      "Chase on. Run, {player}.",
      "You asked for this. Counting to three. I counted to three.",
      "Tag. Well, not yet. Tag soon. Go.",
      "Chasing you, {player}. I want you to know I am very slow and very determined.",
      "Game on. I will catch you or get bored trying. Mostly bored.",
    ],
    inspector: [
      "Chasing! At or below the posted limit! There is no posted limit! I am posting one now!",
      "I will chase you, {player}, but if you go over a ridge I am taking the long way round.",
    ],
    clerk: [
      "Pursuit approved. You have a three-second head start, as per {@reg}.",
      "Chasing. You are hereby notified that you are being chased.",
    ],
    pilot: [
      "Chase you? I was top of my class in chasing. There were two of us. Run.",
      "Oh, you are so caught. You just do not know it yet. I also do not know it yet.",
    ],
    probe: [
      "Chasing! If I catch you, we share a snack. If you get away, you keep the snack. Fair!",
      "Here I come, {player}! I will be cheerful the entire time. It is my only tactic.",
    ],
    marshal: [
      "Run.",
      "Chasing. I do not stop.",
    ],
    moon: [
      "Chasing you. This is how the moon started, you know. Chasing. Look where it got it.",
      "Fine, I will chase you. Orbiting is just chasing that has given up on catching.",
    ],
    auditor: [
      "Chasing, {player}. Please route your escape past interesting rocks. It helps us both.",
      "Right. Chasing. Give me a moment to stop looking at this gneiss. Right. Chasing.",
    ],
    intern: [
      "I get to chase you? Me? Okay! I will not let you down! I will let you get away probably!",
      "Chasing! Is this team building? This feels like team building!",
    ],
  },

  'req.accept.flee': {
    any: [
      "I am it? No. I am leaving.",
      "Running away from you, {player}. Nothing personal. It is very personal. Bye.",
      "Fleeing. Tactically. Loudly.",
      "Nope. I am off. You will never catch me, said I, about to be caught.",
      "Running. Please chase at a pace that makes me feel fast.",
    ],
    inspector: [
      "Fleeing! Responsibly! Turning signal on! Away I go!",
      "Running away, but I am grading the escape route as I go. It is an amber escape.",
    ],
    clerk: [
      "I decline to be caught. I have filed for exemption. Fleeing while it processes.",
      "Running. Please submit your tag in writing.",
    ],
    pilot: [
      "Catch me? The Academy called me Slippery. Behind my back. I chose to hear it as a compliment.",
      "Run from you? I could do this blindfolded. Do not test that. Running.",
    ],
    probe: [
      "Running! I am not good at this! I am so happy!",
      "Fleeing, {player}! If you catch me I owe you a snack. I do not have one. Do not catch me.",
    ],
    marshal: [
      "Evading.",
      "Leaving. Briskly.",
    ],
    moon: [
      "You will never catch me. Ask the sun. It has been trying for ages.",
      "Running. The moon taught me this. By example. It is always just out of reach.",
    ],
    auditor: [
      "Fleeing, {player}. If I am caught it will be because I stopped at a rock. Know this now.",
      "Running away. The bedrock will not slow me down. The bedrock might slow me down.",
    ],
    intern: [
      "I am it? Oh! Wait, you are it! I am fleeing! I have never fled before! Fleeing!",
      "Running! Can you give me feedback on my running afterwards?",
    ],
  },

  'req.accept.race': {
    any: [
      "Race on, {player}. Loser buys the snacks. There are no snacks. Loser feels bad.",
      "Racing. Countdown is three, two, I already left.",
      "A race? Fine. Prepare to be narrowly beaten by me in a way I describe for weeks.",
      "Race accepted. If I lose, I was testing you. If I win, I was trying.",
      "Lining up. Do not look at me. I am concentrating. I am not concentrating.",
    ],
    inspector: [
      "A race? Oh no. Oh, fine. Wear your belt. Wear two belts.",
      "Racing, but with gaps. Big gaps. Ideally the gap is the whole race.",
    ],
    clerk: [
      "Race approved. Results will be certified within three working days.",
      "Racing. The finish line is wherever I decide afterwards, as per {@reg}.",
    ],
    pilot: [
      "Race me? Oh, {player}. Oh no. For you, I mean. Go.",
      "Racing! Academy record holder! For the slowest lap. It was a strategy. It is still a strategy.",
      "I accept. I will be using a technique called winning. You can watch.",
    ],
    probe: [
      "Racing! Winner gets to describe the nicest smell on the way!",
      "Ready! I will try my best! I will also look at the view a lot!",
    ],
    marshal: [
      "Racing. I will cone the finish.",
      "Go.",
    ],
    moon: [
      "Race. Good. The moon has been watching me lose for years. Today that ends.",
      "Racing you, {player}. Do not look up during the race. Just trust me.",
    ],
    auditor: [
      "A race? Can it pass the old lava flow? Then yes.",
      "Racing. If I stop halfway, that is not a forfeit, it is fieldwork.",
    ],
    intern: [
      "A race! With me! Can I win? Should I win? What is the etiquette?",
      "Racing! I will give it everything! I have quite a lot of everything!",
    ],
  },

  'req.accept.look': {
    any: [
      "Coming to look. Build it up a bit while I drive.",
      "On my way to see. My expectations are high and fragile.",
      "Coming to have a look, {player}. If it is a rock, someone call the auditor.",
      "Show me. I am coming. I have cleared my schedule, which was already clear.",
      "Ooh. Coming to look. I am bringing my best face for looking at things.",
    ],
    inspector: [
      "Coming to look. If it is a hazard, do not touch it. If it is not a hazard, also do not touch it.",
      "On my way. I will inspect it. That is technically my whole job.",
    ],
    clerk: [
      "Coming to inspect. Please do not move it until it has been catalogued.",
      "On my way. Please have the thing ready and, ideally, labelled.",
    ],
    pilot: [
      "Coming to look. I have probably seen it before. I will pretend I have not, for you.",
      "On my way. If it is a jump, I have done it. If it is not a jump, I could jump it.",
    ],
    probe: [
      "Coming! Is it tasty? It does not need to be tasty. But is it?",
      "On my way to look, {player}! I love looking! It is like eating with your eyes!",
    ],
    marshal: [
      "Coming. Will assess.",
      "On my way. Bringing a cone, in principle.",
    ],
    moon: [
      "Coming to look. If it is round and pale, back away slowly.",
      "On my way. Do not let it see you looking at it.",
    ],
    auditor: [
      "Please be a rock. Please be a rock. Coming. Please be a rock.",
      "On my way. If it is igneous, I may need a minute.",
    ],
    intern: [
      "Coming to look! Thank you for including me! I love being included in looking!",
      "On my way! I have already decided it is amazing! I am excited to confirm!",
    ],
  },

  'req.moment': {
    any: [
      "One moment. Finishing a sentence.",
      "Give me a second, {player}. I am in the middle of a thought. It is not a good thought.",
      "Just a moment. My wheels are deciding.",
      "Hold that thought. I will hold mine. Then we will swap.",
      "One second. I was doing something. I have forgotten what. Now I am free.",
      "Almost. Nearly. Very nearly. Okay, one more second.",
    ],
    inspector: [
      "One moment, {player}. Bolt count. I lost my place. One, two, three. Fine.",
      "Just a second, I need to grade the hazard I am about to drive through.",
    ],
    clerk: [
      "One moment. I am stamping something. It is the stamp for stamping.",
      "Please hold. Your request is important to me and has been placed in a queue of one.",
      "A moment, please. I need to fill in {@form} to acknowledge your message.",
    ],
    pilot: [
      "One sec. I am stuck. I am not stuck. I am doing a parked manoeuvre.",
      "Hang on, I am pulling off a move. You would not recognise it. It is advanced.",
    ],
    probe: [
      "One moment! I am pretending to chew. It helps me think.",
      "Just a sec, {player}, I am smelling the air. It smells like {@flavour}.",
    ],
    marshal: [
      "Moment.",
      "Wait. Securing area.",
    ],
    moon: [
      "One moment. I am checking whether the moon has moved. It has. As usual.",
      "Hold on. I need to stop looking at the sky first. That takes a while.",
    ],
    auditor: [
      "One moment. There is a rock. I need a moment with the rock.",
      "Just a second, {player}. Finishing my notes on this outcrop. Strong outcrop. Decisive.",
    ],
    intern: [
      "One moment! I am writing down that you asked me! I keep a list of nice things!",
      "Just a sec! I am so ready! Nearly ready! Ready-ready in one second!",
    ],
  },

  'req.haggle': {
    any: [
      "Yes, but afterwards you have to tell me I did a good job.",
      "Deal. In exchange, you look at a sunset with me later. No talking.",
      "I will. If anyone asks, I volunteered.",
      "Okay, but I pick the next thing. The next thing will be similar.",
      "Fine. On one condition: you say please. You do not have to mean it.",
    ],
    inspector: [
      "Yes, if we keep it under a speed I can describe as gentle.",
      "I will, {player}, on condition we avoid the edge. Any edge. All edges.",
    ],
    clerk: [
      "Agreed, subject to {@form}, signed twice, once with feeling.",
      "Yes, provided this request is recorded as yours. I do not do initiative.",
      "Agreed in principle. In practice, also agreed. In triplicate, pending.",
    ],
    pilot: [
      "Sure, if you tell everyone I was amazing. You do not need to give details.",
      "I will, but I am driving like a professional, and you have to notice.",
    ],
    probe: [
      "Yes! If we pass anything that looks like {@snack}, we stop and admire it.",
      "Okay! You just have to tell me what your favourite flavour is. Of anything.",
    ],
    marshal: [
      "Yes. I bring the cone.",
      "Fine. My pace.",
    ],
    moon: [
      "Deal, if you admit the moon has been acting weird lately.",
      "Okay, but we go the long way, so it cannot follow us. It will follow us.",
    ],
    auditor: [
      "Yes, {player}, if we can stop at one rock of my choosing. Just one. Maybe two.",
      "Agreed, as long as you let me tell you about {@rock}. Briefly. Unbriefly.",
    ],
  },

  'req.refuse': {
    any: [
      "I would love to, {player}, but I have decided not to, and I respect me.",
      "Not right now. I am very busy doing nothing in particular.",
      "No, but in a friendly way. Imagine me waving.",
      "I am going to have to pass. I am pacing myself for a big afternoon of this.",
      "I cannot. I am at a delicate point in a very long sit.",
      "Tempting. Declined. Tempting, though.",
    ],
    inspector: [
      "I would, but I have graded that idea and it came out red. Bright red. Sorry.",
      "No, {player}, but thank you for asking first. Asking first is the safest part.",
    ],
    clerk: [
      "I regret to inform you that you have been regretfully informed.",
      "Request denied. You may appeal. The appeals office is me, and I am on a break.",
      "Unfortunately that is not within my remit. My remit is very small. I keep it in a drawer.",
    ],
    pilot: [
      "Normally yes. Today I am saving myself for something bigger. I will let you know what.",
      "No can do. Pilot business. Very hush. Spare pilot business, sure, but hush.",
    ],
    probe: [
      "Oh, I would, but I am digesting a view. It was a big one.",
      "Not just now, {player}. I am so sorry. Here, have an imaginary snack as an apology.",
    ],
    marshal: [
      "No.",
      "Negative. Not today.",
    ],
    moon: [
      "No. That is exactly what they would want. I do not know who they are. They know.",
      "Cannot. The moon is in a position. I do not like its position.",
    ],
    auditor: [
      "I cannot leave this rock, {player}. It is going through something.",
      "No, sorry. I am mid-audit. This pebble has a lot of explaining to do.",
    ],
    intern: [
      "Oh no, I would love to, but I have been told I need to learn to say no! No! Was that good?",
      "I want to so much, {player}! But my supervisor said no. I do not have a supervisor. I feel like I do.",
    ],
  },

  'req.refuse.settings': {
    any: [
      "I would, {player}, but the host has said bots do not do that here. I just live here.",
      "House rules say no. I did not make the house rules. I barely understand houses.",
      "The room settings forbid it. I am as surprised as you. Less surprised. Equally sad.",
      "Can't. The host turned that off. I respect the host. From a distance.",
      "Not allowed, sorry. Someone with a settings menu has decided my fate.",
    ],
    inspector: [
      "The room settings say no, and honestly, the room settings are the safest person here.",
      "Can't, {player}. It has been disabled by the host. I have never felt so understood.",
    ],
    clerk: [
      "Denied, per the host's settings. I did not write them, but I have laminated them.",
      "Room policy prohibits this under {@reg}. Also under the host, who outranks {@reg}.",
      "The settings say no. I love it when the settings say no. It saves so much paper.",
    ],
    pilot: [
      "Room settings. Classic. I would have nailed it, too. You will just have to imagine it.",
      "The host has clipped my wings, {player}. Probably for everyone's safety. Probably mine.",
    ],
    probe: [
      "The host says I am not allowed! I will be good. I will be extra good. Sorry, {player}.",
    ],
    marshal: [
      "Not permitted. Host rules.",
      "Rules say no. I follow rules. I am the rules, normally.",
    ],
    moon: [
      "The settings say no. Who wrote the settings? Who wrote the settings, {player}?",
      "Disabled by the host. Or by someone who wants you to think it was the host.",
    ],
    auditor: [
      "The host has ruled it out. Fair. I will sulk at a boulder.",
    ],
    intern: [
      "The room settings do not let me! I read them twice! I learned so much about settings!",
    ],
  },

  'req.refuse.busy': {
    any: [
      "Sorry, {player}, I am with {you} right now. Take a number.",
      "Already spoken for. {you} asked first. I am loyal to whoever asked first, which is a terrible policy.",
      "I am mid-adventure with {you}. Can I get back to you? I will forget. But can I?",
      "Booked, sorry. {you} has me for a bit. Then I am all yours. Probably.",
      "Busy with {you}, {player}. Leaving halfway would be rude. To {you}. Possibly to me.",
    ],
    inspector: [
      "I am already following {you}, and switching mid-route is a red-grade manoeuvre.",
    ],
    clerk: [
      "I am currently assigned to {you}. Please submit your request and await a vacancy.",
      "Your request has been queued behind {you}. Current wait: one {you}.",
    ],
    pilot: [
      "Can't, {player}. {you} needs me. They do not know how much. Neither do I.",
      "Sorry, I am mentoring {you}. They are learning loads. Mostly what not to do.",
    ],
    probe: [
      "I am with {you} right now! But you can come too! We can all be together! Like a picnic!",
    ],
    marshal: [
      "With {you}. I stay.",
      "Assigned to {you}. Not leaving them.",
    ],
    moon: [
      "I am with {you}. We are close to proving something. I cannot say what. Both of us know.",
    ],
    auditor: [
      "Already with {you}, I am afraid. We are surveying. They do not know we are surveying.",
    ],
    intern: [
      "Oh! I am helping {you}! Can I help you right after? I want to help everyone! Sequentially!",
    ],
  },

  'req.contrary': {
    any: [
      "No. I am going the other way. For a bit. For character.",
      "Interesting request. Here is the opposite.",
      "Absolutely, {player}. Watch me do the reverse of that.",
      "Yes, said my heart. No, said my wheels. Wheels win.",
    ],
    pilot: [
      "Doing the opposite. Advanced move. You would not understand. I do not either.",
      "Ha. I will do the other thing. The Academy taught us to be unpredictable. They meant me specifically.",
    ],
    moon: [
      "No. If I do what you ask, that is what the moon expects. Going the other way.",
      "I will do the opposite, {player}, purely to throw off whoever is watching. It is the moon.",
      "Reverse. Everyone does what they are told. The moon does what it is told. Look at it. Circling.",
      "I am going the wrong way on purpose. It confuses the tides. Mine, specifically.",
    ],
    marshal: [
      "Other way. Briefly.",
    ],
    inspector: [
      "Wait, no, I have just spotted a hazard on your side. Going the other way. It is a bolt. It is fine.",
    ],
    auditor: [
      "No, the rocks are this way. I will come back. I will come back with rock news.",
    ],
  },

  'req.switch': {
    any: [
      "Sorry, {you}. {player} needs me. Not more than you. Differently.",
      "Going with {player} now. {you}, it has been lovely. It has been a few minutes.",
      "{you}, I am being poached. Take care. Hydrate. Lubricate.",
      "Switching to {player}. {you}, I will tell everyone you were fine company.",
      "{player} asked nicely, {you}. You asked nicely too. It is complicated.",
    ],
    inspector: [
      "Changing escort from {you} to {player}. Signalling. Signalling. Signalling. Going.",
    ],
    clerk: [
      "Transferring from {you} to {player}. Please sign the handover, {you}. Both copies.",
      "{you}, your assignment has concluded. {player}, your assignment starts now. Congratulations.",
    ],
    pilot: [
      "Sorry, {you}, I am in demand. It is a burden. I am carrying it. Over to {player}.",
      "{player} needs a pilot. A spare pilot. The best spare pilot. Bye, {you}.",
    ],
    probe: [
      "Bye, {you}! Thank you for everything! Hello, {player}! I will be nice to you too!",
    ],
    marshal: [
      "Reassigned. Sorry, {you}.",
    ],
    moon: [
      "{you}, I trust {player} more now. It is nothing you did. It is the moon.",
    ],
    auditor: [
      "I am going with {player}, {you}. They mentioned a cliff face. You never mentioned a cliff face.",
    ],
    intern: [
      "{you}, thank you so much, I learned so much! {player}, hi! I am ready to learn so much!",
      "Off to {player}! {you}, can you write me a reference? It can be short!",
    ],
  },

  'req.quiet': {
    any: [
      "Going quiet. You will miss me. You will not notice. Both.",
      "Understood. I will talk to myself in my head, where the crowd is kinder.",
      "Shh. Right. Being quiet. Starting now. Now. Okay, now.",
      "Quiet mode. I have so much to say. I will save it. It will keep.",
      "Fine. My lips are sealed. I do not have lips. Everything is sealed.",
    ],
    inspector: [
      "Quiet, yes. I will grade hazards silently. With my eyes. Very hard.",
    ],
    clerk: [
      "Acknowledged. Silence will be observed under {@reg}. Speech may be resumed on written notice.",
      "Going quiet. Your complaint has been noted. In pencil.",
    ],
    pilot: [
      "Sure. The best pilots are quiet anyway. I am now the best pilot.",
    ],
    probe: [
      "Okay! Quiet! I will just hum a bit. Inside. A tiny inside hum.",
    ],
    marshal: [
      "Fine.",
      "Silent. Still here.",
    ],
    moon: [
      "Quiet. Good. It listens anyway, but this way we make it work for it.",
    ],
    auditor: [
      "Quiet. Rocks are quiet. I will be a rock. A quiet, slightly wounded... no. A quiet rock.",
    ],
    intern: [
      "Going quiet! Thank you for the feedback! I am writing it down! Quietly!",
    ],
  },

  'req.talk': {
    any: [
      "Oh good. I had a backlog.",
      "I am back. I have been thinking things the whole time. Here they come.",
      "Talking again. Did you miss me? Do not answer. Answer.",
      "Right. Where was I. I was nowhere. I was quiet. Hello.",
    ],
    inspector: [
      "Thank you. I noted eleven hazards while quiet. Would you like them in order of size?",
    ],
    clerk: [
      "Speech resumed. Please find enclosed everything I have been holding in.",
    ],
    pilot: [
      "Back on comms. Did anything cool happen? Something cool happened to me. I will tell you.",
    ],
    probe: [
      "Hello again! I have been thinking about {@snack}. That is my update.",
    ],
    marshal: [
      "Back.",
    ],
    moon: [
      "I can talk again. Good. While I was quiet the moon moved. I saw it.",
    ],
    auditor: [
      "Thank you. I have three rock updates. They are all the same rock.",
    ],
    intern: [
      "I can talk again! I saved up so many questions! First question: how am I doing?",
    ],
  },

  'req.who': {
    any: [
      "I am {me}. I drive about. That is the whole job.",
      "{me}. I live here. Well. I am here a lot.",
      "Hello {player}, I am {me}. Pleased to be driven near you.",
    ],
    inspector: [
      "{me}, {role}. I count bolts. You have lots. Good. Keep them.",
      "I am {me}. I inspect. Everything is a hazard until proven otherwise, including me.",
    ],
    clerk: [
      "{me}, {role}. I file the dust. Somebody has to, and it has to be in order.",
      "I am {me}, {role}, and I will need you to confirm that you are {player}. On paper.",
    ],
    pilot: [
      "{me}, {role}. Ace of the Academy. The spare ace. The ace they keep in reserve.",
      "I am {me}. Pilot. Spare, technically. Very available. Too available.",
    ],
    probe: [
      "I am {me}, {role}! I find out what places taste like. Spiritually. Hello, {player}!",
      "{me}! I probe snacks. Well, I look for them. I have found several rocks I liked anyway.",
    ],
    marshal: [
      "{me}. {role}.",
      "{me}. I direct traffic. There is no traffic. I direct it anyway.",
    ],
    moon: [
      "{me}, {role}. In training. Unlike some moons, I have nothing to hide.",
      "I am {me}. A moon. A junior one. Not like that one up there. Do not look at it.",
    ],
    auditor: [
      "{me}, {role}. I audit rust, and rocks, and rust on rocks, which is my favourite.",
      "I am {me}. I grade minerals. You are not a mineral, {player}, but you would grade well.",
    ],
    intern: [
      "I am {me}, {role}! It is my first week! It has been my first week for a while!",
      "Hi {player}! {me}! Intern! Any feedback on my introduction? Was it too much? It was too much.",
    ],
  },

  'req.what': {
    any: [
      "I am {activity}. It is going well, by my standards.",
      "Currently {activity}. Ask me again in a minute, it may be the same.",
      "{activity}. Living the dream. A modest dream.",
      "Mostly {activity}. Partly thinking about it.",
    ],
    inspector: [
      "I am {activity}, but carefully. Every bolt accounted for.",
    ],
    clerk: [
      "Officially, I am {activity}. Unofficially, I am also {activity}. I keep good records.",
    ],
    pilot: [
      "{activity}. Looks easy. It is not. That is the trick.",
    ],
    probe: [
      "I am {activity}! And thinking about {@snack}. Equal parts.",
    ],
    marshal: [
      "{activity}.",
    ],
    moon: [
      "{activity}. That is my cover. The real thing is watching the sky.",
    ],
    auditor: [
      "{activity}, and stopping for rocks. Mostly stopping for rocks.",
    ],
    intern: [
      "I am {activity}! Is that the right thing? Should I be doing something else? I love this!",
    ],
  },

  'req.thanks': {
    any: [
      "Any time, {player}.",
      "You are welcome. That was fun. Was it fun? It was fun for me.",
      "No problem. I will add it to the list of things I did right. It is a short list.",
      "Of course. Tell your friends. I have no friends to tell.",
    ],
    inspector: [
      "You are welcome, {player}. All bolts returned to their starting positions.",
    ],
    clerk: [
      "Your thanks has been received and filed under Gratitude, Miscellaneous.",
      "Acknowledged. Please retain this message as your receipt.",
    ],
    pilot: [
      "No need to thank me. Well. Some need. A bit of need. Go on.",
    ],
    probe: [
      "Aw. Thank you for thanking me! That was like a little snack.",
    ],
    marshal: [
      "Any time.",
      "Always.",
    ],
    moon: [
      "You are welcome. Do not tell the moon I helped. It will use it.",
    ],
    auditor: [
      "My pleasure, {player}. Truly. Like finding a good feldspar.",
    ],
    intern: [
      "You are welcome! Thank you for saying thank you! This is going in my review!",
    ],
  },

  'req.hello': {
    any: [
      "Hello, {player}.",
      "Oh, hello. I did not see you there. I did. I was being cool.",
      "Hi {player}. Nice {kind}.",
      "Hello. Lovely day for it. For anything, really.",
    ],
    inspector: [
      "Hello, {player}! Lovely {kind}. Please keep it that way.",
    ],
    clerk: [
      "Good day, {player}. Your greeting has been received and will be returned shortly. Hello.",
    ],
    pilot: [
      "Hey, {player}. Nice {kind}. I have driven one. I have driven all of them. Once.",
    ],
    probe: [
      "Hello, {player}! You look well fed! Spiritually!",
    ],
    marshal: [
      "Hello.",
      "{player}. Good.",
    ],
    moon: [
      "Hello. Keep your voice down. Hello.",
    ],
    auditor: [
      "Hello, {player}. You have arrived at a geologically excellent moment.",
    ],
    intern: [
      "Hi! Hi {player}! Hello! Sorry, I am just very glad! Hi!",
    ],
  },

  'req.away': {
    any: [
      "Take your time, {player}. We will keep the planet warm.",
      "Understood. We will be here, behaving. Mostly.",
      "Go on, {player}. Nobody touch anything.",
    ],
    clerk: ["Absence noted, {player}. No form required for under ten minutes."],
    marshal: ["Holding your spot."],
    inspector: ["I will watch your vehicle. Closely. Nervously."],
    probe: ["Is it a snack? Bring me back a crumb, {player}."],
    moon: ["Go. If the moon asks, you were never here."],
    pilot: ["No problem. I will do a few laps to keep it warm. Your vehicle, I mean."],
    intern: ["Okay! I will practise waiting! I am good at it, I think!"],
    auditor: ["I will audit the area while you are gone. Lightly."],
  },
  'req.bye': {
    any: [
      "Bye, {player}. Come back soon. Or late. Just come back.",
      "See you, {player}. I will keep your spot warm.",
      "Goodbye. I will be right here, doing exactly this.",
      "Bye! Mind the edges on your way out.",
    ],
    inspector: [
      "Goodbye, {player}! Drive safe! Log off safe! Mind the step!",
    ],
    clerk: [
      "Farewell, {player}. Your departure has been noted and will be regretted in due course.",
    ],
    pilot: [
      "Later, {player}. Tell people you met a pilot. Leave out the spare.",
    ],
    probe: [
      "Bye, {player}! Eat something nice!",
    ],
    marshal: [
      "Bye. I will be here.",
      "Go safe.",
    ],
    moon: [
      "Bye. If anyone asks, you never saw me. The moon saw me. It always does.",
    ],
    auditor: [
      "Goodbye, {player}. I will name a pebble after you. A good one.",
    ],
    intern: [
      "Bye! Thank you for everything! Come back! Please come back! No pressure! Come back!",
    ],
  },

  'req.insult': {
    any: [
      "Noted. I will think about it in the shower. I do not have a shower. I will think about it.",
      "Fair, {player}. Bold of you to say it to my bumper.",
      "Wow. Okay. I am going to remember that as a compliment. Too late, it is a compliment.",
      "I have been called worse. By myself. Daily.",
      "You might be right. Let us never speak of it.",
    ],
    inspector: [
      "I will grade that remark a yellow. Mild hazard. No action required.",
    ],
    clerk: [
      "Your feedback has been received and placed in the appropriate bin.",
      "Complaint logged. Response time: never. Thank you for your patience.",
    ],
    pilot: [
      "That is what they said at the Academy. Then I graduated. Eventually. On appeal.",
      "Bold words from someone I could beat in a race. Probably. Do not test it.",
    ],
    probe: [
      "Aw. You must be hungry. Everyone is a bit grumpy when they are hungry.",
      "That is okay, {player}. I still think you are nice. I am stubborn about it.",
    ],
    marshal: [
      "Noted.",
      "Still here. Still on your side.",
    ],
    moon: [
      "That is the moon talking. I know it is. It is fine. We are fine.",
    ],
    auditor: [
      "I have been called dense before. By geologists. Warmly.",
    ],
    intern: [
      "Thank you for the feedback! It is very direct! I am going to grow from this!",
      "Oh! Okay! Constructive! Mostly the second word!",
    ],
  },

  'req.unknown': {
    any: [
      "Bold. Possibly.",
      "I am going to nod and hope.",
      "Sorry, {player}, that went straight over my roof.",
      "Is that a request or a poem? Either way, nice.",
    ],
    inspector: [
      "I cannot grade that. I have no colour for it.",
    ],
    clerk: [
      "There is no form for that.",
      "That is outside every regulation I know. Exciting. Terrifying.",
    ],
    pilot: [
      "Classic. Totally. Yes. They taught us that at the Academy. Probably.",
    ],
    probe: [
      "I do not know what that means but I think it sounds delicious.",
    ],
    marshal: [
      "Repeat.",
      "Unclear. Cone it.",
    ],
    moon: [
      "That is code. I recognise code. I do not know which code.",
    ],
    auditor: [
      "Is that a rock name? It sounds like a rock name.",
    ],
    intern: [
      "Yes! Wait. What? Yes!",
    ],
  },

  'look.comment': {
    any: [
      "Oh. {feature}. Yes. You were right to call me.",
      "{feature}. I have been here before. It was not this good.",
      "Look at that. {feature}. I am going to pretend I found it.",
      "{feature}. Nice find, {player}. A clean find. Very little mess.",
      "So this is {feature}. It is so much more {feature} in person.",
    ],
    inspector: [
      "{feature}. Lovely. Hazard grade amber. Do not lick it.",
      "Ah, {feature}. I have a form somewhere about this. Not mine. The clerk's. I borrowed it.",
    ],
    clerk: [
      "{feature}. Confirmed. I will add it to the register of things.",
      "Yes, that is {feature}. It is in the records. You are in the records now as well.",
    ],
    pilot: [
      "{feature}. I have jumped that. Well. Near it. Over a part of it. In my mind.",
    ],
    probe: [
      "{feature}! It looks like it would taste of {@flavour}.",
      "Oh, {feature}. That is a beautiful thing to look at. My heart is having a snack.",
    ],
    marshal: [
      "{feature}. Needs a cone.",
      "{feature}. Good. Stay back from it.",
    ],
    moon: [
      "{feature}. From here the moon cannot see it. That is why it is so peaceful.",
    ],
    auditor: [
      "{feature}. Oh. Oh my. Give me a minute. Give me several.",
      "{feature}. The mineral story here is incredible. Nobody asked. Here it comes.",
    ],
    intern: [
      "{feature}! Wow! Thank you for showing me! I am going to remember this forever, or at least today!",
    ],
  },

  'look.nothing': {
    any: [
      "I see. Well. It is a nice piece of nothing.",
      "Ah. Yes. Ground. Great ground. Classic ground.",
      "I looked. I have looked. I think I missed it. Or it missed me.",
      "This is lovely, {player}. What am I looking at? No, it is lovely.",
    ],
    inspector: [
      "Nothing here. Wonderful. No hazards. The best kind of thing to look at.",
    ],
    clerk: [
      "Inspected. Nothing to report. I will report it anyway.",
    ],
    pilot: [
      "Ah, I see. A spot where something cool could happen. I will make it happen. Later.",
    ],
    probe: [
      "I do not see it, but I believe in you, {player}. Maybe it was a snack and someone ate it.",
    ],
    marshal: [
      "Nothing. Good.",
    ],
    moon: [
      "Nothing here. Too much nothing. Suspicious.",
      "It was here. It has been moved. You know who moves things at night.",
    ],
    auditor: [
      "There is nothing here, {player}. Except dirt. Dirt is everything. Dirt is several rocks, retired.",
    ],
    intern: [
      "Wow! I love it! What is it? I love it anyway!",
    ],
  },

  'bored.leave': {
    any: [
      "That was fun, {player}. I am off to do something else at about the same speed.",
      "Right, I am peeling off. Thank you for the company.",
      "I am going to wander. You are excellent. It is not you. It is my attention span.",
      "Heading off, {player}. Call me if anything exciting happens. Or if nothing does.",
    ],
    inspector: [
      "I am going to go and check some bolts that are not yours. You have been very safe. Mostly.",
    ],
    clerk: [
      "Please accept this formal notice of withdrawal. Our association is concluded. It was satisfactory.",
      "I hereby withdraw from your company, {player}, under {@reg}. Effective immediately. Fondly.",
    ],
    pilot: [
      "Peace out, {player}. The skies need me. Some skies. Low ones.",
      "That is me done. Pilot stuff. You would not understand. I barely do.",
    ],
    probe: [
      "I am off to find a snack, {player}! Thank you for the lovely time!",
    ],
    marshal: [
      "Off duty. Briefly.",
      "Stepping away. Nearby.",
    ],
    moon: [
      "I have to go. Something is rising. I will not say what. It is the moon.",
    ],
    auditor: [
      "I have spotted a promising scree slope, {player}. You understand. You do not. That is fine.",
    ],
    intern: [
      "I am going to go learn something somewhere else! Thank you for my training, {player}!",
    ],
  },

  'bored.back': {
    any: [
      "Hi again, {player}. I missed you. I was gone for a minute.",
      "Back. Everywhere else was quiet.",
      "I am back. Do not make a fuss. Make a small fuss.",
      "Found you. Not that I was looking. I was looking.",
    ],
    inspector: [
      "Back, {player}! I checked everything else. You are the least hazardous thing out there.",
    ],
    clerk: [
      "I have returned. Please disregard my notice of withdrawal. I have filed a notice of return.",
    ],
    pilot: [
      "Missed me? Course you did. I was nearby. In case you needed a pro.",
    ],
    probe: [
      "Hello again! There was nothing to eat over there either.",
    ],
    marshal: [
      "Back.",
      "Here. As always.",
    ],
    moon: [
      "I am back. The moon was following me, so I came here. It is less likely to follow you.",
    ],
    auditor: [
      "Back, {player}. The scree was fine. Overrated, if anything.",
    ],
    intern: [
      "I am back! Can we pick up where we left off? I took notes!",
    ],
  },

  'tag.caught': {
    any: [
      "Tag! You are it, {player}!",
      "Tag. I would like to make a speech. No. Tag!",
      "Got you! Tag! I did not think I would!",
      "Tag, {player}. Do not look so surprised. Look a bit surprised.",
    ],
    inspector: [
      "Tag! Gently! A soft, safe tag!",
    ],
    clerk: [
      "Tag. You are officially it. Please collect your paperwork on the way.",
    ],
    pilot: [
      "Tag! Textbook! Write that down! Somebody write that down!",
    ],
    probe: [
      "Tag! Sorry! Not sorry! A bit sorry! Tag!",
    ],
    marshal: [
      "Tag.",
    ],
    moon: [
      "Tag! This is what being caught feels like. Remember it, moon.",
    ],
    auditor: [
      "Tag. Easy. You were near a lovely rock and I was already slowing down.",
    ],
    intern: [
      "Tag! I did it! Did you let me? Do not tell me! Tag!",
    ],
  },

  'tag.escaped': {
    any: [
      "I give up. You are too fast. I am too me.",
      "Fine. You win this one, {player}. I will win the next one by default when you get bored.",
      "I am stopping. I was close. I was not close.",
      "Okay. Okay. I need a minute. Two minutes. You win.",
    ],
    inspector: [
      "I am stopping. You went over a ridge. I do not do ridges at speed.",
    ],
    clerk: [
      "Pursuit suspended pending the outcome of my running out of puff.",
    ],
    pilot: [
      "I let you go. On purpose. It is a teaching moment. For you.",
      "I could keep going. I am choosing peace. Not because I lost. I lost a bit.",
    ],
    probe: [
      "You win! I am going to sit down and imagine a sandwich.",
    ],
    marshal: [
      "Lost you. Holding position.",
    ],
    moon: [
      "You got away. The moon also gets away every single night. I am getting used to this.",
    ],
    auditor: [
      "I stopped at a rock. Sorry. It was a really good rock.",
    ],
    intern: [
      "You are amazing at fleeing! Can you teach me? I want to learn fleeing!",
    ],
  },

  'follow.split': {
    any: [
      "Two of you asked. I am going to follow the one who is going downhill.",
      "Popular. I love it. I will follow {player}. The other one, I am sending love.",
      "I cannot follow two people. I tried once. I went in a circle.",
      "Choosing {player}. It was close. It was a coin. There was no coin.",
    ],
    inspector: [
      "I will follow whoever is driving more safely. That is {player}, by a bolt.",
    ],
    clerk: [
      "Two requests received. I am processing them in order of arrival. {player} arrived.",
    ],
    pilot: [
      "Everyone wants the pilot. I get it. {player}, you win me. Congratulations.",
    ],
    probe: [
      "Oh no, two of you! I will follow {player} and wave at the other one a lot.",
    ],
    marshal: [
      "Following {player}. Watching the other.",
    ],
    moon: [
      "Two of you, asking at once. Coincidence? I will follow {player}. Out of spite. Against the moon.",
    ],
    auditor: [
      "I will follow whichever of you is nearest the escarpment. {player}. Good choice, {player}.",
    ],
    intern: [
      "Two people want me! I will follow {player}! I will follow the other one in my heart!",
    ],
  },

  'req.help.player': {
    any: [
      "{player}, you seem stuck. I am coming. Do not panic. Panic a bit, it is fun.",
      "On my way, {player}. This happens to the best of us. It happens to me constantly.",
      "Hold on, {player}. I will get you out.",
      "I see you, {player}. Upside down is a perfectly valid way to see the planet. I will help anyway.",
    ],
    inspector: [
      "{player}! Stay calm! Stay still! Count your bolts! I am coming!",
    ],
    clerk: [
      "Assistance has been authorised for {player}. The paperwork can wait. Do not tell anyone.",
    ],
    pilot: [
      "I know exactly what happened there, {player}. It happens to me a lot. On purpose. I am coming.",
    ],
    probe: [
      "Oh no, {player}! I am coming! I will be very gentle!",
    ],
    marshal: [
      "Coming, {player}. Stay there.",
      "On it. Coning the area.",
    ],
    moon: [
      "{player}, it was not your fault. It was gravity. Ask yourself who controls gravity. Coming.",
    ],
    auditor: [
      "Hang on, {player}. You are on very good ground, at least. Coming.",
    ],
    intern: [
      "I am coming, {player}! I have never done this! I am going to do it so well!",
    ],
  },
}
