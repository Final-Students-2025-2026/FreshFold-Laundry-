import Reveal from './ui/Reveal';

/**
 * Six promises, each one a thing the business actually does.
 *
 * The previous six were "Hygienic Fabric Separation", "Fast Turnaround Time",
 * "Affordable Predictable Pricing" — headings in a language nobody speaks,
 * sitting in six identical bordered cards with an index number and the words
 * "Verified Quality Standard" underneath. A claim is worth something when it is
 * specific enough to be broken.
 */
const PROMISES = [
  {
    title: 'Your washing never meets anyone else’s.',
    detail:
      'Each household’s load runs on its own, in its own drum. Nothing gets mixed, and nothing comes back that was not yours.',
  },
  {
    title: 'Next day, as standard.',
    detail:
      'Collected today, back tomorrow, on every ordinary order. If you need it the same day, express costs ₵50 on top.',
  },
  {
    title: 'The price you see is the price.',
    detail:
      'Every service has one number against it, and it is the same number the booking form charges. No handling fee turns up at the end.',
  },
  {
    title: 'Pickup and delivery cost nothing.',
    detail:
      'On every order and every plan, anywhere we reach in Kumasi. There is no minimum load and no delivery charge.',
  },
  {
    title: 'You can see where your bag is.',
    detail:
      'From collection to the doorstep, your order page shows which stage it is on and where the rider currently is.',
  },
  {
    title: 'If it is not right, we do it again.',
    detail:
      'Tell us within 24 hours of delivery and it goes back through the wash at no charge. You do not have to make a case for it.',
  },
];

export default function WhyChooseUs() {
  return (
    <section
      id="why-choose-us"
      className="border-b border-white/10 bg-brand-charcoal py-20 font-ui sm:py-28"
    >
      <div className="mx-auto grid max-w-[88rem] gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:gap-14">
        {/* The heading holds its own column and stays put while the promises
            scroll past it — the section is a list of answers to one question,
            so the question should still be on screen. */}
        <Reveal className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <h2 className="font-display text-section font-medium text-white text-balance">
              Why send it to us.
            </h2>
            <p className="mt-5 max-w-[40ch] text-lead text-brand-text-muted">
              Six things we will hold to. Every one of them is specific enough that you would know
              if we broke it.
            </p>
          </div>
        </Reveal>

        <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:col-span-8" id="why-choose-us-grid">
          {PROMISES.map((promise, index) => (
            <Reveal key={promise.title} delay={index * 0.04}>
              <div className="border-t border-white/15 pt-5">
                <h3 className="max-w-[24ch] font-display text-[26px] font-medium leading-[1.15] text-white text-balance">
                  {promise.title}
                </h3>
                <p className="mt-3 max-w-[46ch] text-body text-brand-text-muted">
                  {promise.detail}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
