import { useState } from 'react';
import {
  Bike,
  Calendar,
  ClipboardCheck,
  DoorOpen,
  WashingMachine,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import Reveal from './ui/Reveal';
import StageArt from './ui/StageArt';

/**
 * The six stages, written the way the shop would say them.
 *
 * `note` is the one thing about a stage a customer would not assume. Nothing
 * here promises anything the business does not already do: the rider tracking
 * is the live map in the client portal, the re-wash is the same 24-hour promise
 * the plans carry.
 */
const STAGES = [
  {
    title: 'You book a pickup',
    icon: Calendar as LucideIcon,
    when: 'About two minutes',
    detail:
      'Pick the day and the time window that suit you, on this site or by calling the shop. Tell us then if anything in the bag needs handling differently — a delicate, a stain, a suit.',
    note: 'No account needed to book the first one.',
  },
  {
    title: 'A rider collects it',
    icon: Bike as LucideIcon,
    when: 'Same day',
    detail:
      'A FreshFold rider comes to your door, tags the bag against your order and takes it to the shop. You get an order number the moment it is on board.',
    note: 'You can watch the rider on the map from your order page.',
  },
  {
    title: 'It gets washed',
    icon: WashingMachine as LucideIcon,
    when: 'Four to eight hours',
    detail:
      'Your load runs on its own. Water temperature, detergent and cycle are set by what is actually in the bag, and nothing of yours shares a drum with another household.',
    note: 'Never mixed with anyone else’s laundry. Not once.',
  },
  {
    title: 'Dried, pressed, folded',
    icon: Wind as LucideIcon,
    when: 'Two to four hours',
    detail:
      'Low heat, so nothing shrinks and nothing sets. Shirts and trousers are pressed and hung; sheets, towels and everyday clothes are folded flat and squared off.',
    note: 'Say the word and shirts come back on hangers instead.',
  },
  {
    title: 'Checked before it is packed',
    icon: ClipboardCheck as LucideIcon,
    when: 'Before it leaves',
    detail:
      'Every item is looked over once more under proper light. Anything still marked goes back for another attempt at the stain rather than going out as finished.',
    note: 'If it still is not right, tell us within 24 hours and we redo it free.',
  },
  {
    title: 'Back at your door',
    icon: DoorOpen as LucideIcon,
    when: 'The slot you picked',
    detail:
      'The rider returns it in the delivery window you chose, wrapped, folded and ready to go straight into the wardrobe. You sign for it at the door.',
    note: 'Pickup and delivery cost nothing, on every order.',
  },
];

export default function HowItWorks() {
  const [activeStage, setActiveStage] = useState(0);
  const stage = STAGES[activeStage];

  return (
    /*
      The one section that is not charcoal.

      Olive is FreshFold's colour and it had been spending the whole page as a
      1px hover border and a blurred blob. Here it is the ground: the process —
      the part of the business that is actually theirs — is the part that gets
      painted in it. White on this olive is 7.7:1, and the panel inverts back to
      charcoal so the two halves of the section hold each other up.
    */
    <section
      id="how-it-works"
      className="bg-brand-sage py-20 font-ui text-white sm:py-28"
    >
      <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
        <Reveal className="max-w-[46ch]">
          <h2 className="font-display text-section font-medium text-balance">
            Six stages, start to finish.
          </h2>
          <p className="mt-5 text-lead text-white/80">
            From the moment the bag leaves your door to the moment it comes back. Pick any stage to
            see what happens in it.
          </p>
        </Reveal>

        {/* The rail. A real sequence, so the numbers are information rather
            than decoration. */}
        <Reveal className="mt-14" delay={0.05}>
          <ol
            className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/25 sm:grid-cols-3 lg:grid-cols-6"
            id="timeline-node-selectors"
          >
            {STAGES.map((item, index) => {
              const isActive = index === activeStage;
              return (
                <li key={item.title} className="contents">
                  <button
                    onClick={() => setActiveStage(index)}
                    aria-current={isActive ? 'step' : undefined}
                    className={`group flex h-full flex-col gap-2 px-4 py-5 text-left transition-colors duration-300 ${
                      isActive
                        ? 'bg-brand-charcoal text-white'
                        : 'bg-brand-sage text-white/85 hover:bg-brand-sage-dark hover:text-white'
                    }`}
                    id={`timeline-btn-${index}`}
                  >
                    <span className="flex items-center gap-2.5">
                      <item.icon
                        aria-hidden="true"
                        className={`h-[18px] w-[18px] shrink-0 transition-colors duration-300 ${
                          isActive ? 'text-brand-gold' : 'text-white/80'
                        }`}
                      />
                      {/* white/80 rather than /70: on this olive, 70% lands at
                          4.47:1 and the bar for 13px text is 4.5. */}
                      <span
                        className={`text-[13px] font-semibold tnum ${
                          isActive ? 'text-brand-gold' : 'text-white/80'
                        }`}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </span>
                    <span className="text-[15px] font-medium leading-snug tracking-[-0.01em]">
                      {item.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Reveal>

        {/* The stage itself, on the inverted panel. */}
        <Reveal className="mt-6" delay={0.1} id="timeline-explainer-display">
          <div
            key={activeStage}
            className="panel-swap grid gap-8 rounded-lg bg-brand-charcoal p-7 sm:p-10 lg:grid-cols-12 lg:items-center lg:gap-12"
          >
            <div className="lg:col-span-7">
              <p className="text-label font-medium text-brand-gold tnum">
                Stage {String(activeStage + 1).padStart(2, '0')} of 06 · {stage.when}
              </p>
              <h3 className="mt-3 font-display text-sub font-medium text-white">{stage.title}</h3>
              <p className="mt-4 max-w-[62ch] text-lead text-brand-text-muted">{stage.detail}</p>
              <p className="mt-6 max-w-[62ch] border-t border-white/15 pt-5 text-body text-brand-text-light">
                {stage.note}
              </p>
            </div>

            {/* The drawing for this stage. Decorative and `aria-hidden` — it
                repeats what the paragraph beside it already says, which is why
                it is allowed to be purely pleasurable. */}
            <div className="order-first flex justify-center lg:order-none lg:col-span-4 lg:col-start-9 lg:justify-end">
              <StageArt stage={activeStage} className="h-40 w-40 sm:h-52 sm:w-52" />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
