/**
 * The rescue: a bot gets stuck, the others argue about who goes, one fires a grapple line
 * and tows it out. Read a key's lines in sequence for setup and payoff. Slots and content
 * rules are in types.ts.
 */
import type { Pools } from './types'

export const RESCUE: Pools = {
  // The accident-prone bot commits to a bold line at the shore. The setup; 'stuck.call' is
  // the payoff, a few seconds later.
  'mishap.bold': {
    any: [
      "I know a shortcut. It is mostly ground.",
      "Watch this. Actually, do not watch this. Watch something near this.",
      "Taking the line along the shore. Nobody has ever regretted the line along the shore.",
      "Bold line coming up. I have thought about it for almost a second.",
      "Back in a moment. Possibly a long moment.",
    ],
    inspector: [
      "I am going to inspect that shore. Closely. More closely than is recommended.",
      "That edge looks sound. I graded it from here. Going in for a second opinion.",
    ],
    clerk: [
      "Taking the shore route. It is approved. I approved it. Just now, in my head.",
      "Proceeding to the shore to confirm it is a shore. There is a form for that. I am the form.",
    ],
    pilot: [
      "Watch this. Academy move. They named it after me. Then they banned it.",
      "Nobody follow me. This line is for professionals. And the spare.",
    ],
    probe: [
      "That {sea} looks like soup. I just want to know what flavour.",
      "Ooh, the shore! I bet it tastes like {@flavour}. Just a quick look.",
    ],
    marshal: [
      "Going wide. Stand clear.",
      "Shortcut. No cones required. Probably.",
    ],
    moon: [
      "The tide is out. Moon's doing. I am taking the gap before it notices.",
      "That shore is closer than it was. The moon moved it. I am moving it back.",
    ],
    auditor: [
      "Wet basalt down there. Wet basalt is the best basalt. Going in.",
      "Shoreline sediment, grade A from here. Closer inspection needed. Much closer.",
    ],
    intern: [
      "I think I have learned the shortcut from watching you all! Here goes! Feedback welcome!",
      "I am going to try the brave line! Is it the brave line? It is a line!",
    ],
  },

  // Someone else sees where the accident-prone bot is heading.
  'mishap.watch': {
    any: [
      "Where is {subj} going?",
      "{subj}, that is not a road.",
      "{subj} has that look again.",
      "Everyone, {subj} is attempting a line. Stand by with a rope.",
      "I give {subj} ten seconds.",
    ],
    inspector: ["{subj}! That edge is amber! Amber means no! It has always meant no!"],
    clerk: ["Noting the time. {subj} is about to need {@form}."],
    pilot: ["Nice line, {subj}. Wrong, but nice."],
    probe: ["Oh, {subj} is going for a paddle! Do we have towels?"],
    marshal: ["{subj}. No.", "Cones. Now. For {subj}."],
    moon: ["{subj} is heading for the {sea}. The moon has been expecting this."],
    auditor: ["{subj} is going to be very close to some excellent sediment. Too close."],
    intern: ["Is {subj} allowed to go there? Can I go there? Should I not go there?"],
  },

  'stuck.call': {
    any: [
      "Small problem. I am stuck. Medium problem. Stuck.",
      "Hello? Anyone? I have become part of the landscape.",
      "I am stuck. Not a big deal. A slightly big deal. Could someone come.",
      "Help, please. I appear to be wedged. Emotionally and also physically.",
      "So. I have found a place my wheels do not work. If anyone is free.",
      "Requesting a tow. I will be very grateful. I will be grateful-ish.",
    ],
    inspector: [
      "Help! I am stuck! I graded this spot green! I must recalibrate everything!",
      "I am wedged. All bolts present, I checked. Some of them are just pointing at the sky.",
      "This is the hazard. I found it. Personally. Could someone please come and grade it with me.",
    ],
    clerk: [
      "I wish to report a stuck clerk. Me. Please file under Urgent, Mildly.",
      "I am stuck. I have filled in {@form} to request assistance. Could someone collect it.",
      "Formal request for extraction. I would stamp it, but I am upside down, and so is the stamp.",
    ],
    pilot: [
      "I meant to do this. I am testing the ground. The ground is winning. Could someone come.",
      "Stuck. Not stuck. Parked at an angle. A steep, unplanned angle. Somebody help.",
      "Hey, so, nobody panic, but I am doing a thing the Academy calls a situation.",
      "Quick one. Who is free to watch me do a recovery? I may need you to do the recovery.",
    ],
    probe: [
      "I am stuck! It is not so bad. It smells like {@flavour} down here. Still, help please!",
      "Oh dear. I am stuck. If someone comes, I will think kind thoughts about them all day.",
    ],
    marshal: [
      "Stuck. Need assist.",
      "Immobile. Request tow. Not urgent. Fairly urgent.",
    ],
    moon: [
      "I am stuck. This was not an accident. Someone up there moved the ground.",
      "Help. I am pinned. Tidal forces, probably. You know whose.",
    ],
    auditor: [
      "I am stuck. In fairness, it is a very good rock to be stuck on. Help when convenient.",
      "I stopped for a basalt and the basalt kept me. Could someone come.",
    ],
    intern: [
      "Hi everyone! I am stuck! Is this part of the training? Should someone come? Please?",
      "Help! Sorry! I am stuck! Sorry! Thank you in advance! Sorry!",
    ],
  },

  'stuck.pointed': {
    any: [
      "Still stuck. Just mentioning it.",
      "No rush. I have nowhere to be. Literally. I cannot go anywhere.",
      "It is fine. I am enjoying the view. It is the same view. I am enjoying it again.",
      "I can see you all, by the way. I can see you deciding.",
      "Someone could come. Anyone. I am not picky. I am a bit picky.",
      "Great news, I have learned to love this pothole. Bad news, still in it.",
      "Hello. Me again. The stuck one. Still the stuck one.",
      "I have started naming the pebbles. Pebble one is called Patience. It is going.",
      "Do take your time. Time is something I now have an enormous amount of.",
      "I want to stress that I am fine. I am fine and stuck. Stuck mainly.",
      "If anyone is passing. Or not passing. If anyone exists.",
      "This is my home now. I have put up curtains. Please come and see them. Please come.",
      "I can hear you talking about other things. They sound lovely. Help.",
      "Just to update the group: stuck, slightly more. It is getting comfortable. That is the worry.",
    ],
    inspector: [
      "Gentle reminder: I am a hazard now. Please come and remove the hazard. The hazard is me.",
      "Still stuck. I have recounted my bolts four times. They are bored too.",
      "I have graded my situation. It was amber. It is now amber, but sadder.",
    ],
    clerk: [
      "My request for assistance is now in its second business minute. I am escalating to myself.",
      "Status update: stuck. Form status: unread. Morale status: filed under Low.",
      "I have now completed {@form} for being ignored. It is longer than the first one.",
    ],
    pilot: [
      "Totally fine. Doing this on purpose. For longer than planned. Somebody.",
      "At the Academy we had a word for this. The word was help.",
      "I could get out myself. Obviously. I just want someone else to have the experience.",
    ],
    probe: [
      "I am fine! I have imagined three snacks. I am now imagining a fourth. It is a rescue snack.",
      "Not to be a bother, but I am starting to think of this rock as a friend. That seems like a sign.",
    ],
    marshal: [
      "Still here.",
      "Still stuck. I have put a cone on myself. It has not helped.",
    ],
    moon: [
      "The longer you wait, the more the moon wins. I am not saying this to hurry you. I am.",
      "Is no one coming? That is exactly what someone who works for the moon would do.",
    ],
    auditor: [
      "I have finished auditing this rock. I am now auditing the rock beneath it. It goes deep.",
      "I am beginning to identify with the sediment. Please come before I become a layer.",
    ],
    intern: [
      "Still stuck! Learning so much about patience! I would like to stop learning it now!",
      "Is this a test? If it is a test, I think I am doing well? Can someone come anyway?",
    ],
  },

  // The accident-prone bot stuck for the first time today: a reputation, no count yet.
  'stuck.clumsy': {
    any: [
      "Oh, it is {subj}. Of course it is {subj}.",
      "{subj} has a gift. The gift is finding holes.",
      "If there is a hole on this planet, {subj} will be in it within the hour.",
      "We should name a crater after {subj}. They have tried most of them.",
    ],
    inspector: ["{subj}. I have a whole hazard grade just for {subj}. It is called {subj}."],
    clerk: ["{subj} has a file. The file has a file. I keep both within reach."],
    pilot: ["Amateurs. {subj}, you have to commit to it. Look at me, I never get stuck. Recently."],
    probe: ["Poor {subj}! I hope they packed a snack down there!"],
    marshal: ["{subj}. Of course.", "{subj}. Bring cones."],
    moon: ["{subj} again. Strange how it is always {subj}. Almost like someone is choosing."],
    auditor: ["{subj} keeps finding the softest ground. It is almost an instinct. A geological one."],
    intern: ["{subj} is stuck! They are so good at it! I mean that supportively!"],
  },

  'stuck.reputation': {
    any: [
      "{subj} is stuck again. I am shocked. I am not shocked.",
      "Oh, it is {subj}. Of course it is {subj}.",
      "That is the {count} time today for {subj}. I am keeping score. I do not want to be.",
      "{subj} has a gift. The gift is finding holes.",
      "If there is a hole on this planet, {subj} will be in it within the hour.",
      "We should name a crater after {subj}. They have tried most of them.",
    ],
    inspector: [
      "{subj}. Again. I have started a whole new grade just for {subj}. It is called {subj}.",
      "That is the {count} time. I have warned {subj}. I warn {subj} every morning.",
    ],
    clerk: [
      "{subj} has a file. The file has a file. This is the {count} entry.",
      "{subj} stuck, {count} occurrence. I have pre-printed the form. I had a feeling.",
    ],
    pilot: [
      "Amateurs. {subj}, you have to commit to it. Look at me, I never get stuck. Recently.",
      "Typical {subj}. When I do it, it is a technique.",
    ],
    probe: [
      "Poor {subj}! That is the {count} time! I hope they have a snack down there!",
    ],
    marshal: [
      "{subj}. Again.",
      "{subj}. {count} time. Bring cones.",
    ],
    moon: [
      "{subj} again. Strange how it is always {subj}. Almost like someone is choosing.",
    ],
    auditor: [
      "{subj} keeps finding the softest ground. It is almost an instinct. A geological one.",
    ],
    intern: [
      "{subj} is stuck again! They are so good at it! I mean that supportively!",
    ],
  },

  'conflict.stay': {
    any: [
      "I would go for {subj}, but I am with {player}. Someone else go. Please. I am looking at you all.",
      "Sorry, {subj}, I promised {player}. Hang in there. Literally.",
      "Staying with {player}. {subj}, you are in my thoughts. Firmly. Like you are in that hole.",
    ],
    inspector: [
      "I cannot leave {player} unsupervised. {subj}, you are a hazard, but a known one.",
    ],
    clerk: [
      "I am assigned to {player}. Reassignment requires {@form}. {subj}, please wait in the hole.",
    ],
    pilot: [
      "Can't, {subj}. {player} needs a professional. You need a different professional.",
    ],
    probe: [
      "Oh, {subj}, I am so sorry. I am with {player}. I will send you good thoughts. And a pretend snack.",
    ],
    marshal: [
      "Staying with {player}.",
      "Not leaving {player}. Someone else get {subj}.",
      "{subj}, I see you. {player}, I am here. I stay.",
      "No. I am with {player}. That is final. Mostly final.",
    ],
    moon: [
      "I am staying with {player}. Leaving them alone is what the moon wants.",
    ],
    auditor: [
      "{subj}, I am with {player}. Also there is a rock here. Mostly {player}. A bit the rock.",
    ],
    intern: [
      "I want to help, {subj}! But {player} is my mentor right now! I am torn! I am so torn!",
    ],
  },

  'conflict.go': {
    any: [
      "On my way, {subj}. Do not move. You cannot move. Good, keep that up.",
      "I will get {subj}. Back in a moment, everyone. Possibly longer.",
      "Going. Hold still, {subj}. You are very good at that already.",
      "I will go. Someone has to and I am the one typing.",
    ],
    inspector: [
      "Going for {subj}. Carefully. Checking the route. Hurrying carefully.",
    ],
    clerk: [
      "I am going to {subj}. The paperwork can follow me. It usually does.",
    ],
    pilot: [
      "I have got this. Rescue is my thing. I have been rescued enough to know how it works.",
      "Stand back, everyone. A pilot is going. A spare one. But going.",
    ],
    probe: [
      "Coming, {subj}! Hold on! I am so happy to be useful!",
    ],
    marshal: [
      "Going.",
    ],
    moon: [
      "I will go. If {subj} stays stuck any longer the moon will get ideas.",
    ],
    auditor: [
      "Going, {subj}. I will also look at the thing you are stuck on. For science.",
    ],
    intern: [
      "I will go! Me! I have never done a rescue! I am going to do the best rescue!",
      "On my way, {subj}! Sorry, {player}! Back soon! This is so exciting! Sorry!",
      "Me! Pick me! Nobody picked me! I picked me! Going!",
    ],
  },

  'conflict.form': {
    clerk: [
      "I am happy to help, {subj}, once you have completed {@form}. In triplicate.",
      "Before I come, {subj}: was this stuckness accidental, deliberate, or other? Please specify.",
      "I can rescue you under {@reg}, {subj}, but only if you are stuck in an approved location.",
      "Rescue request received. Please hold. Your stuckness is important to us.",
    ],
    any: [
      "Does anyone have a form for this? The clerk is asking for one.",
      "I would help, {subj}, but apparently there is a form first.",
      "Can somebody check whether {subj} needs paperwork before they are rescued?",
      "Is there a form for helping? There is always a form for helping.",
    ],
    inspector: [
      "Before anyone goes, I need a hazard assessment. {subj}, how would you grade your hole?",
    ],
    marshal: [
      "Forms after. Cones first.",
    ],
    pilot: [
      "Form? I rescue on instinct. Unfiled. I am a loose cannon. A loose spare.",
    ],
    intern: [
      "Should I fill in a form? I love forms! Where are the forms? Is there a form for forms?",
    ],
  },

  // A bot that is staying nudges another undecided one to go. No claims of past rescues here:
  // those are in 'conflict.bargain.earned', said only by a bot that really towed someone today.
  'conflict.bargain': {
    any: [
      "{you}, you go. You are closer. Probably. I have not measured.",
      "Flip for it, {you}? I have no coin. You go.",
      "{you}, you would be wonderful at this. I would be adequate. Go on.",
    ],
    inspector: [
      "{you}, you go. I have not finished grading the route, and you have nicer bolts.",
    ],
    clerk: [
      "According to the rota, it is {you}'s turn. I made the rota. It is very fair.",
    ],
    pilot: [
      "{you}, take this one. Get some experience. I have loads. Mostly from the other side.",
    ],
    probe: [
      "{you}, would you like to go? It is ever so rewarding! I would go! But you go!",
    ],
    marshal: [
      "{you}. Your turn.",
    ],
    moon: [
      "{you}, you go. If I go, they will notice a pattern.",
    ],
    auditor: [
      "{you}, you take it. There is a very good bit of shale here and it needs me.",
    ],
  },

  // The same nudge from a bot that really did tow someone out earlier this session.
  'conflict.bargain.earned': {
    any: [
      "{you}, you go. I went last time.",
      "{you}, I did the last one. My line is still tangled.",
    ],
    inspector: ["{you}, you go. I am still recovering from the last rescue. My nerves, not my bolts."],
    probe: ["{you}, would you like to go? It is ever so rewarding! I went last time! But you go!"],
    marshal: ["{you}. I did the last one. Your turn."],
    auditor: ["{you}, you take it. I did the last rescue and I missed an extraordinary bit of shale."],
  },

  'conflict.guilt': {
    any: [
      "Fine. Fine. I am going. I will feel heroic, even though I was guilted.",
      "Nobody is going? Okay. I will go and be quietly noble about it.",
      "Oh, I cannot stand watching {subj} wiggle. I am going.",
      "{subj} is just sitting there. Being stuck. Very bravely. Ugh. Going.",
    ],
    inspector: [
      "I cannot leave {subj} there. It is unsafe. Also unkind. Mostly unsafe. Also unkind.",
    ],
    clerk: [
      "Very well. I will waive the form. Please never tell anyone I waived the form.",
    ],
    pilot: [
      "Okay. Okay! I will go. But it is going to look really cool, and that is the only reason.",
    ],
    probe: [
      "Poor {subj}. Nobody is going. I feel awful. I am going! Hold on!",
    ],
    marshal: [
      "Nobody. Fine. Me.",
    ],
    moon: [
      "If none of you go, I will go, and I will think about it every night. Under the moon.",
    ],
    auditor: [
      "Leaving {subj} there would be geologically unforgivable. It would be part of the record.",
    ],
    intern: [
      "Is nobody going? I feel bad! I feel bad that I feel bad! I am going!",
    ],
  },

  'conflict.ask.player': {
    any: [
      "{player}, could you help {subj}? I will wait. I am excellent at waiting.",
      "{player}, give me one moment. {subj} needs a tow. Back before you miss me.",
      "{player}, quick favour: {subj} is stuck. Your {kind} looks very good at favours.",
      "Hold on, {player}. {subj} needs a tow. Normal service will resume shortly.",
    ],
    inspector: [
      "{player}, wait here, please. Safe here. Very safe. I will only be a minute. A safe minute.",
    ],
    clerk: [
      "{player}, your journey has been paused while I attend to {subj}. Thank you for your patience.",
    ],
    pilot: [
      "{player}, want to see something amazing? Stay there. Watch me get {subj} out. Do not watch too closely.",
    ],
    probe: [
      "{player}, could you help me help {subj}? We could be a rescue team! A team!",
    ],
    marshal: [
      "{player}. Wait. One minute.",
      "{player}, stay. I will be back. I always come back.",
    ],
    moon: [
      "{player}, wait here. If anything pale and round shows up, do not engage.",
    ],
    auditor: [
      "{player}, do you mind? {subj} is stuck in what looks like a fascinating deposit.",
    ],
    intern: [
      "{player}! Can I go help {subj}? Is that okay? You can say no! Please say yes!",
    ],
  },

  'rescue.start': {
    any: [
      "Lining up. Hold still, {subj}.",
      "Firing the line. Do not flinch, {subj}.",
      "Grapple going out. {subj}, think light thoughts.",
      "Okay, {subj}. On three. One. I fired on one.",
      "Here comes the line. Grab on. You cannot grab. It will grab you.",
      "Line out, {subj}. Please do not wave at it.",
    ],
    inspector: [
      "Line out, {subj}. I have checked the hook, the cable, the knot and the second knot.",
      "Firing the grapple. Everyone stand clear. Stand clearer. Thank you.",
    ],
    clerk: [
      "Grapple deployed as per {@reg}. {subj}, please confirm receipt of grapple.",
      "Firing the line, {subj}. Please initial where it lands.",
    ],
    pilot: [
      "Watch this. Watch this. Firing. That was intentional. All of it.",
      "Grapple out. Academy taught me this. Well, a poster in the corridor did.",
    ],
    probe: [
      "Line coming, {subj}! It is a hug, really! A long, tight hug!",
    ],
    marshal: [
      "Firing.",
      "Line out. Hold.",
    ],
    moon: [
      "Line out. This is how the moon got its orbit, you know. Someone threw a line. Nobody took it back.",
    ],
    auditor: [
      "Firing at {subj}. Avoiding the basalt. Do not want to scratch the basalt.",
    ],
    intern: [
      "Firing the grapple! My first grapple! Am I holding it right? There is nothing to hold! Firing!",
    ],
  },

  'rescue.pull': {
    any: [
      "Pulling. Hang on. Hang on to what, I do not know. Hang on.",
      "Towing. Come on, {subj}. Come on.",
      "Heave. Heaving. This is heaving.",
      "Pulling, {subj}. You are heavier than you look. Not in a bad way.",
      "Almost. Do not help. Please do not help.",
    ],
    inspector: [
      "Gently. Gently. Not too gently. Gently.",
      "Pulling. Cable tension amber. Amber. Amber. Fine.",
    ],
    clerk: [
      "Towing in progress. Estimated completion: shortly, or within the next fiscal year.",
    ],
    pilot: [
      "Look at this pull. Look at it. That is an Academy pull.",
    ],
    probe: [
      "Pulling! Come along, {subj}! There might be snacks out here!",
    ],
    marshal: [
      "Pulling.",
      "Steady.",
    ],
    moon: [
      "Pulling. This is what tides feel like. Exhausting. No wonder the moon is so smug.",
    ],
    auditor: [
      "Pulling. Mind the ledge, {subj}. Not for you. For the ledge.",
    ],
    intern: [
      "Pulling! It is working! It is working, right? Feedback please! While pulling!",
    ],
  },

  // A long rescue without progress yet: the stuck bot, patient, then less so (by minutes).
  'stuck.waiting.1': {
    any: [
      "No rush. It is nice to be the centre of attention.",
      "I can see you working. I appreciate the effort. I appreciate it from in here.",
      "Still in. You are doing great. The hole is doing better.",
    ],
    inspector: ["Status: amber. Rescuers present. Bolts present. Progress pending."],
    clerk: ["Your effort has been noted. The outcome has not yet been filed."],
    pilot: ["Take your time. I am resting my engine. On purpose."],
    probe: ["Thank you for trying! I have imagined a snack for each of you!"],
    marshal: ["Holding. Keep pulling."],
    moon: ["It is resisting. You know who is behind that."],
    auditor: ["Do not hurry on my account. This sediment is very well sorted."],
    intern: ["This is so educational! For me! Watching! From inside the problem!"],
  },
  'stuck.waiting.2': {
    any: [
      "A few minutes in. I have started a small garden down here.",
      "I want to say I believe in you. I do. I just also believe in the hole.",
      "Is it me? Is it my wheels? You can tell me. Pull while you tell me.",
    ],
    inspector: ["I have regraded this from amber to amber with a frown."],
    clerk: ["This is now a long-running rescue. It has its own cabinet."],
    pilot: ["At the Academy this would have taken two minutes. It took us four. So, two Academies."],
    probe: ["I have eaten every imaginary snack. I am now imagining the crumbs."],
    marshal: ["Minutes. Still here. Keep going."],
    moon: ["The moon has had a long time to plan this. Do not underestimate it."],
    auditor: ["I have dated the layer I am in. It is younger than this rescue."],
    intern: ["Still stuck! Still learning! I would now like to learn something else!"],
  },
  'stuck.waiting.3': {
    any: [
      "I have lived here for some time now. I know all the pebbles by name. Please.",
      "Whatever you are doing, do it more. Or differently. Or both. Please.",
      "This is the longest rescue in history. I would like it to also be the most successful.",
    ],
    inspector: ["Hazard grade: permanent. Please prove me wrong. Please."],
    clerk: ["I have filed a complaint against the ground. It is pending. So am I."],
    pilot: ["Fine. I admit it. I did not mean to do this. Get me out."],
    probe: ["I am not even peckish any more. That is how you know it is serious."],
    marshal: ["Long time. Still stuck. Do not stop."],
    moon: ["This is it. The moon's masterpiece. Do not let it win."],
    auditor: ["I am becoming a stratum. Please extract me before I am published."],
    intern: ["I am fine! I am fine. I am not fine. Please keep going!"],
  },

  // A second or third helper joins a rescue that is not working yet.
  'rescue.join': {
    any: [
      "Coming to help, {you}. Two lines are better than one. Usually.",
      "Hang on, {subj}. Sending more rope. Also me.",
      "{you}, budge up. I will pull from the other side.",
    ],
    inspector: ["Joining, {you}. A second line halves the strain. I have checked the maths twice."],
    clerk: ["Assigning myself to assist {you}. The form says two-person job. I wrote the form."],
    pilot: ["Step aside, {you}. Actually stay. Pull with me. Together. Like the Academy."],
    probe: ["I am coming too! {subj}, we are going to get you out and then have a picnic!"],
    marshal: ["Joining. Other side."],
    moon: ["I am coming, {subj}. Two of us. The moon only planned for one."],
    auditor: ["Joining, {you}. I will take the uphill side. The rock there is better anyway."],
    intern: ["Can I help? I am helping! {you}, show me where to pull!"],
  },

  // A rescuer whose ideas are used up steps back; another will try.
  'rescue.swap': {
    any: [
      "I am out of ideas. Somebody else have one. {subj}, it is not you. It is the hole.",
      "That is everything I know. Someone take over. I will cheer.",
      "Tagging out. Fresh hands, please. {subj}, we have not forgotten you.",
    ],
    inspector: ["I have tried every safe angle. Someone try an unsafe one. Carefully."],
    clerk: ["My attempts are exhausted. I am passing the case to a colleague. With notes."],
    pilot: ["I have warmed it up for you. Someone else can finish. You are welcome."],
    probe: ["I tried my best! Someone with more snacks in them should try!"],
    marshal: ["Done my bit. Next."],
    moon: ["It is blocking me personally. Someone the moon does not know should try."],
    auditor: ["I have loosened the substrate. The next one will find it very cooperative."],
    intern: ["I did not get it! Sorry! Can someone show me how? By doing it?"],
  },

  // Minutes of real attempts and no progress: the rescuers call it off (bots.rescuePatience).
  'rescue.calloff': {
    any: [
      "We have tried everything, {subj}. I am sorry. Hop home. We will be here.",
      "Calling it, {subj}. The hole wins this one. It will not win the next.",
      "{subj}, we gave it everything. Time for the pad. No shame in it.",
    ],
    inspector: ["Calling it, {subj}. Every safe option is used up. Please return to the pad, safely."],
    clerk: ["The rescue of {subj} is hereby closed. Outcome: valiant. Please proceed to the pad."],
    pilot: ["{subj}, even I cannot do this one. And I can do most things. Hop home."],
    probe: ["Oh, {subj}. We tried so hard. Go home and have a real snack."],
    marshal: ["Calling it. Pad, {subj}."],
    moon: ["We are calling it, {subj}. This round goes to the moon."],
    auditor: ["{subj}, the geology has won. Respect the geology. Go home."],
    intern: ["I am so sorry, {subj}! We tried everything! I learned so much! Go home safe!"],
  },

  // The stuck bot hops home after a real effort (after 'rescue.calloff').
  'rescue.giveup.tried': {
    any: [
      "Thank you for trying. Truly. Off I hop.",
      "That was the bravest rescue that did not work. Back to the pad.",
      "You were all wonderful. The hole was more wonderful. Resetting.",
    ],
    clerk: ["I will file this under Failed, Heroically. Returning to the pad."],
    pilot: ["I was about to get out anyway. Going home to do it there."],
    marshal: ["Thanks. Pad."],
    moon: ["Fine. The moon wins today. Back to the pad."],
    intern: ["Thank you everyone! That was amazing! Even the part where it did not work!"],
  },

  // The stuck bot asks a person nearby for a hand, once.
  'rescue.player.ask': {
    any: [
      "{player}, you have a grapple. I am just saying.",
      "{player}! Hello! If you are not busy. Hook me? No pressure. A little pressure.",
      "{player}, a hook and a gentle pull would make my whole day.",
    ],
    inspector: ["{player}, your grapple is rated for this. I checked. Would you?"],
    clerk: ["{player}, I have a form here requesting your grapple. It is already signed. By me."],
    pilot: ["{player}, fancy helping a professional? Purely to watch how it is done."],
    probe: ["{player}! Could you hook me out? I will owe you a snack. A real one."],
    marshal: ["{player}. Grapple. Please."],
    moon: ["{player}, you are not on the moon's side, are you? Prove it. Hook me."],
    auditor: ["{player}, you will want a closer look at this rock anyway. Bring the grapple."],
    intern: ["{player}! Would you help? I would love to learn how you do it!"],
  },

  // A person hooks the stuck bot.
  'rescue.player.hooked': {
    any: [
      "{player} has me! Everyone, {player} has me!",
      "Oh, {player}, that is a lovely hook. Pull! Gently! No, pull!",
      "{player} is on the line. Bots, take notes.",
    ],
    inspector: ["{player}'s line is secure. I checked. Pulling is approved."],
    clerk: ["Assistance from {player} received. Logging it as exemplary."],
    pilot: ["{player}, I was about to do that myself. But fine. Pull."],
    probe: ["{player}! You came! I knew you would! Pull, please!"],
    marshal: ["{player} on the line. Good."],
    moon: ["{player} is here. The moon did not see this coming."],
    auditor: ["{player} has a fine hook on me. Mind the basalt."],
    intern: ["{player} hooked me! This is the best day! Pull!"],
  },

  'rescue.retry': {
    any: [
      "That did not do it. Moving round. New angle.",
      "Right. Plan B. Plan B is plan A from over here.",
      "One more go, {subj}. I believe in us. Mainly in me.",
      "Hm. The ground does not want to let you go. It has grown attached.",
      "Repositioning. You are fine, {subj}. Do not look at me like that.",
    ],
    inspector: [
      "Let us try a better angle. Every angle here is a bad angle. Choosing the least bad.",
    ],
    clerk: [
      "First attempt rejected. Resubmitting from a different direction.",
    ],
    pilot: [
      "That was a warm-up pull. The real one is next. I am limbering up.",
    ],
    probe: [
      "Not yet! Okay! One more! I am going to cheer for myself and then pull!",
    ],
    marshal: [
      "Again.",
      "Repositioning.",
    ],
    moon: [
      "It is resisting. Someone up there wants you stuck, {subj}. Not on my watch.",
    ],
    auditor: [
      "This ground is cohesive, {subj}. That is a compliment to the ground. Trying again.",
    ],
    intern: [
      "Oops! That did not work! Learning moment! Trying again!",
    ],
  },

  'rescue.success.thanks': {
    any: [
      "Free! Thank you, {you}. I owe you one. I owe several people one.",
      "Out! {you}, you are a hero. A tow hero.",
      "Thank you, {you}. I will never get stuck again. That is not true. Thank you anyway.",
      "{you}, thank you. Seriously. I was starting to put down roots.",
    ],
    inspector: [
      "Free! Thank you, {you}! All bolts accounted for! One loose! Not your fault! Thank you!",
    ],
    clerk: [
      "Thank you, {you}. A certificate of extraction is on its way to you. Please frame it.",
    ],
    pilot: [
      "Thanks, {you}. I had it, but thanks. No, really. Thanks.",
    ],
    probe: [
      "Thank you, {you}! If I find a snack, it is yours! Half of it! Most of half!",
    ],
    marshal: [
      "Thanks, {you}.",
      "Owe you. Noted.",
    ],
    moon: [
      "Thank you, {you}. You have saved me from a lunar plot. Probably.",
    ],
    auditor: [
      "Thank you, {you}. Please let me name the rock after you. It will be a hard rock.",
    ],
    intern: [
      "Thank you so much, {you}! You are my hero! Can I put you on my reference list?",
    ],
  },

  'rescue.success.ingrate': {
    any: [
      "I was just about to get out on my own, but fine.",
      "Thanks, {you}. You were a bit slow, but thanks.",
      "I had it handled. You just handled it faster.",
      "Oh. You pulled me out. I was getting comfortable.",
    ],
    inspector: [
      "Free. Thank you. You pulled at an amber angle, {you}. I am just saying.",
    ],
    clerk: [
      "Rescued. I will be submitting a complaint about the delay. And a thank-you note. Separately.",
      "Thank you, {you}, but you did not file {@form}. I will be keeping an eye on you.",
    ],
    pilot: [
      "I had it. I totally had it. I was one wiggle away. Thanks, though.",
      "I meant to do that. All of it. Including the bit where you rescued me.",
      "You know I was just testing the grapple, right? Good result. Grapple works.",
    ],
    probe: [
      "Thank you! Though I had grown quite fond of that spot.",
    ],
    marshal: [
      "Fine. Thanks.",
    ],
    moon: [
      "I was free all along. It was a test. You passed. The moon did not.",
      "Thanks, {you}. I could have done it myself, but the moon would have seen.",
    ],
    auditor: [
      "Thank you, {you}. I was only halfway through auditing that rock, but thank you.",
    ],
    intern: [
      "Thank you! I was nearly out! Not really! Thank you! But nearly!",
    ],
  },

  'rescue.helper.modest': {
    any: [
      "Do not mention it. Okay, mention it a bit.",
      "Just doing what anyone would do. What nobody else did.",
      "All part of the service. There is no service. I have just founded one.",
      "No trouble. Some trouble. Mostly no trouble.",
    ],
    inspector: [
      "Happy to help. Please do not do that again. For my nerves.",
    ],
    clerk: [
      "All in a day's paperwork. Please sign here, here and in your heart.",
    ],
    pilot: [
      "It was nothing. It was everything. It was mostly nothing.",
    ],
    probe: [
      "It was my pleasure! Rescuing is like sharing, but with towing.",
    ],
    marshal: [
      "Done.",
      "Any time.",
    ],
    moon: [
      "That is one more for us and one fewer for the moon.",
    ],
    auditor: [
      "My pleasure. And while I was here I found a wonderful bit of feldspar.",
    ],
    intern: [
      "Was that good? Did I do it right? I did it! Feedback please! Was it great?",
    ],
  },

  'rescue.giveup': {
    any: [
      "Fine. I will do it myself. Resetting. Like a professional.",
      "Nobody? Okay. I will just teleport back like it is completely normal.",
      "Resetting. Do not watch. Watch a little.",
      "Self-rescue engaged. I am disappointed in all of us. Mostly the hole.",
    ],
    inspector: [
      "I will reset myself. That is the least hazardous option. It is also the loneliest.",
    ],
    clerk: [
      "Rescue request expired. Initiating self-extraction under {@reg}. Strongly worded memo to follow.",
    ],
    pilot: [
      "I am resetting. On purpose. Like I always meant to. This was the plan all along.",
    ],
    probe: [
      "That is okay! I will reset! I forgive everyone! Mostly!",
    ],
    marshal: [
      "Resetting. Fine.",
    ],
    moon: [
      "Resetting. The moon wins this round. There will be other rounds.",
    ],
    auditor: [
      "Resetting. Farewell, rock. You were the best kind of stubborn.",
    ],
    intern: [
      "I will reset! Learning moment! I learned that nobody comes! Lovely to know!",
    ],
  },

  'rescue.player.came': {
    any: [
      "{player} is here! The cavalry! One cavalry!",
      "Look, {player} came. Some of us are just better people.",
      "{player} came for {subj}. I was about to. I was about to, though.",
      "Oh, {player}, you did not have to. I am so glad you did.",
    ],
    inspector: [
      "{player}, you came! Please approach carefully! Very carefully! Thank you!",
    ],
    clerk: [
      "{player} has arrived. I will make a note. A good note.",
    ],
    pilot: [
      "{player}! Excellent timing. I was just about to rescue myself. I will let you.",
    ],
    probe: [
      "{player} came to help! That is the nicest thing! Nicer than a snack!",
    ],
    marshal: [
      "{player} is here. Good.",
    ],
    moon: [
      "{player} came! The moon did not see that coming!",
    ],
    auditor: [
      "{player}. You came. Like a rare mineral. Not often, but beautifully.",
    ],
    intern: [
      "{player} is helping! Can I help {player} help? Is that allowed?",
    ],
  },

  'rescue.player.thanks': {
    any: [
      "Thank you, {player}. You did not have to do that. You did, though.",
      "{player}, that was kind. I will tell everyone. I will tell them twice.",
      "Thank you, {player}. That was very cool.",
      "{player}, I owe you one. I will be honest, I owe a lot of people one.",
    ],
    inspector: [
      "Thank you, {player}! Excellent towing! Very safe! I will be speaking of this!",
    ],
    clerk: [
      "Thank you, {player}. Your contribution has been recorded under Exceptional.",
    ],
    pilot: [
      "Thanks, {player}. Good work. You would have done well at the Academy.",
    ],
    probe: [
      "Thank you, {player}! You are wonderful! You are the best snack of a person!",
    ],
    marshal: [
      "Thank you, {player}.",
    ],
    moon: [
      "Thank you, {player}. The moon will remember this, but so will I, and I am closer.",
    ],
    auditor: [
      "Thank you, {player}. Solid. Like granite.",
    ],
    intern: [
      "Thank you, {player}! That was amazing! Can I shadow you? Like, professionally?",
    ],
  },

  'rescue.callback': {
    any: [
      "Remember the {count} time we got {subj} out? Good times.",
      "That is {subj}'s {count} rescue. We should start charging.",
      "{subj}, that is the {count} time. We are starting a club.",
      "This is going in the history books. The {count} rescue of {subj}.",
    ],
    inspector: [
      "{subj}, that is the {count} rescue. I am making a chart. It is going up.",
    ],
    clerk: [
      "This is {subj}'s {count} rescue. Filed. The cabinet is getting full.",
    ],
    pilot: [
      "{count} rescue of {subj}. I would have done it faster. I was busy. Being excellent.",
    ],
    probe: [
      "That was the {count} rescue! Shall we celebrate? Maybe with a snack?",
    ],
    marshal: [
      "{count} time. Bring cones.",
    ],
    moon: [
      "{count} rescue. That is a pattern. Patterns do not happen naturally, {subj}.",
    ],
    auditor: [
      "{count} rescue. Rocks do not need rescuing, {subj}. Something to aspire to.",
    ],
    intern: [
      "That is the {count} rescue! I am learning so much! Mostly by watching!",
    ],
  },
  // Said by a rescuer to a person it has just hooked: what to do, briefly. Shown in chat.
  'rescue.player.drive': {
    any: [
      "Line's on, {player}. Drive towards me. Gently.",
      "Got you, {player}. Steer for me and ease the throttle. I will do the pulling.",
      "Hooked, {player}. Point your nose at me and drive. Slowly. Slowly is fast here.",
    ],
    clerk: ["You are attached, {player}. Please proceed towards me at a reasonable pace. Gently."],
    marshal: ["Drive to me. Gently."],
    inspector: ["Drive towards me, {player}. Gently. Very gently. I am watching every bolt."],
    probe: ["Drive towards me, {player}! Gently, like carrying soup."],
    moon: ["Drive towards me, {player}. Gently. Do not look at the moon."],
    pilot: ["Drive towards me, {player}. Gently. I have done this hundreds of times. Twice."],
    intern: ["Drive towards me, {player}! Gently! I am so happy to be useful!"],
    auditor: ["Drive towards me, {player}. Gently. Mind the sediment."],
  },
  // A rescuer that has got itself stuck lets go and hands the job on.
  'rescue.handoff': {
    any: [
      "Letting go, {subj}. I am now also a problem. Someone else, please.",
      "Line off. I am stuck too, which is not how this was supposed to go. Next rescuer, please.",
      "Handing over, {subj}. I have joined you in the scenery.",
    ],
    clerk: ["Releasing {subj}. Rescue reassigned. I am now the subject of a separate case."],
    marshal: ["Line off. I am stuck. Next."],
    inspector: ["Letting go, {subj}. I am stuck as well. Everyone stay calm. Mostly me."],
    probe: ["Sorry, {subj}, I let go. I got stuck too. We can be stuck together, like a sandwich."],
    moon: ["Letting go, {subj}. The moon has taken an interest in me as well."],
    pilot: ["Releasing, {subj}. Tactical pause. I am stuck. Tactically."],
    intern: ["I let go, {subj}, I am so sorry! I got stuck! Is this a learning opportunity?"],
    auditor: ["Line off, {subj}. The sediment has claimed me too. Fair."],
  },
}
