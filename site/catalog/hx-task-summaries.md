# HX task summaries

Human-readable summaries shown on the site's setup task pages (/hx-tasks/<id>).
The page never shows the prompt itself. A task without an entry shows "No
summary yet.". Same format and rules as task-summaries.md, except there is no
baseline file: a missing entry is allowed.
Get a task's description_sha with `deno task summary-audit --print-sha <id>`;
for HX tasks it is the sha256 of harness-tasks/tasks/<id>/prompt.md.

## HX-007
description_sha: 7b908ea969910021632c674129fab0b03cd39f2686c243060eb2fb9da1617fe3

A feature for rental contract pricing: amounts are to be rounded per branch instead of with one company-wide setting. The change covers the invoice preview as well as single and batch posting.

## HX-008
description_sha: 10ba5a06f63c7b5b634c88f73a227f1ded20acf7f5c8b4edcd654eb1e7b458e8

A feature for the leasing app that invoices every due lease in one batch run. The run also keeps a log of the leases that could not be invoiced.

## HX-009
description_sha: 2269b65eb95fdd7cce8bc7b99f0198d9659ff8240d029719cd02823609051dac

A feature for rental contracts that adds a charge for vehicles brought back late, with a new setup value and a return date on the contract. The charge has to appear wherever a contract is priced.

## HX-010
description_sha: ef474534df1be1f56c49fa0e4e157286389587140465d2babd2c97f865baf212

A feature for revenue reporting: rental ledger entries record the branch of their contract, and a new query in the reporting app summarises rental revenue by branch and month.

## HX-011
description_sha: 56c2d182a4ac034e407541c440736705ed63d4b2451023ffd4ede01a2d1a6d98

A bug fix in lease payment schedules and lease invoicing.

## HX-012
description_sha: 24f62200da91db9bc862efc78a24a69cc4f9fb837eac9f431cf7a4c7f3d72cf9

A bug fix that touches the application's general setup and several areas that read it.

## HX-013
description_sha: 0dd10e4e063417f1b6a41f918ba5f0a0ca0e4335ce568d453b7c1d3d56228252

A bug fix in vehicle availability, tied to the workshop's service and damage processes in the fleet module.

## HX-014
description_sha: cda0e030d67ab1af397dba104220c3763913d00008535469f62258f5a654319f

A change to vehicle service planning: each maintenance strategy gets its own default service interval, which the next service date uses when a service plan does not set one.

## HX-015
description_sha: a151e3ffcb1ad65ef400f984938e3b1061f8fec5e191be1e423e8cb9c6e0def0

A feature for rental contracts that lets the front desk see the rental ledger entry a posting would create, without posting the contract.

## HX-016
description_sha: 6d7ba21f4a85480f234d011b7a743570d65f66606531d56485522cfc34e02e96

A test-writing task for the integration outbox: the model writes automated tests that pin down how message dispatch and retries must behave. The tests are run against correct and faulty versions of the code.

## HX-017
description_sha: 18bba362164dafba36579ef3e63d8f2847240d7849381df83b8e1ca1a4e4654d

A test-writing task for posting returned rental contracts in batches. The model writes automated tests for the specified behaviour, and those tests must pass on correct code and catch faulty versions.

## HX-018
description_sha: a5a8b688fc0b635bd5722bd76fedb80c0dd5df07b84011d9da15f582421cd6ca

A test-writing task for vehicle service plans and the check for whether a vehicle is due for service. The tests are judged by passing on correct code and failing on faulty variants.

## HX-019
description_sha: b7d5acecc5fb0f5ce39dba4105d3de5b2b1c92063283bad0b507e0be58ac984c

A feature for rental pricing that lets partner extensions add their own price lines to a contract. Those lines must then count everywhere a contract is priced.

## HX-020
description_sha: b9645fe7fd8a10e82304efb380337cf9abff8ada527e4f10429e8f3cc0d93f17

A feature for the integration outbox: new procedures let a fleet migration pause and resume the queueing of outgoing vehicle messages while it runs.

## HX-021
description_sha: 407e210bdba4b980f33947d3109ede73926000e4558bb79917a23a2437730451

A feature for rental batch posting: a simulation that reports which contracts a run would post, with their ledger entries, and which would fail, without changing any data.

## HX-022
description_sha: f4171fb335acbab62303f5a4202344a1ae23684c50425c07d3f225e54a934ce0

A feature for the fleet office: change a vehicle's number when it gets new plates, keeping the vehicle and everything recorded for it under the new number.

## HX-023
description_sha: 254bb138dbe3822f01671b16117e604542a29006de0abd6ce8c7ea23ac1e079c

A bug fix in the accounting exports for lease invoice lines and rental ledger entries. The shared formatting rules move into a new helper in Core that both exports use.

## HX-024
description_sha: f9e714ad654962b161aed845f3f75fc819410dd28b3b738990b0ea3d4a9568bd

A bug fix in the customer overview of the reporting app.

## HX-025
description_sha: ead62d1f575695ca5534fd8f75983d713a4530f8a0f173bd4e389c6d4ce37d17

A bug fix in the import of service records sent by the workshop portal.

## HX-026
description_sha: 68bc5a725d13bbb30daacb9f411120305ce84cc0c09eaa049a0347f7431a3607

A refactoring task in Core: tracking of the user's current working branch moves into its own codeunit, as the ticket describes.

## HX-027
description_sha: de3f1126f2b0b52ea4e21a11dddbcf30d340a3ba29868a262142db2f69ed2de2

A feature for the lease desk: preview the payment schedule a lease would get without saving it, built by the same logic as schedule creation.

## HX-028
description_sha: ae88090ccac077aa6cc994cbb07be084d1199b32ed050d93ce2b1b90427277ff

A clean-up across the working-day calendar and rental pricing. The model moves a date rule that two places compute on their own into one shared procedure in the core app, and every existing result must stay the same.

## HX-029
description_sha: e5d8b5d55a150f6f7d6cf60fd66b154596bffb7af0b69bc7a4003da4d640168b

A test-writing task for lease invoicing. The model adds a new test codeunit that pins down the specified invoicing behaviour, and the tests are scored on passing against correct code and catching faulty versions of it.

## HX-030
description_sha: 8ae4ecbfa097cc9c733fa601a83ea5a938ebb9edcd55d00bf552e18ec84653a5

A test-writing task for the rental invoice preview and its pricing. The model writes a new test codeunit from the described behaviour, and the tests must pass on correct code and fail on faulty variants.

## HX-031
description_sha: ec46ffe1be5e853b23c6e1554103de0178ece66f93056c82c697d20c083f0f2a

A feature for the rental front desk: a new codeunit that keeps an end-of-shift summary of posted and failed rental contracts, with a reset. Single and batch posting must otherwise behave as before.

## HX-032
description_sha: 2817ad7bcc538f3cc120e233f9f58e4e6d18d80153e1cbe8e09acbbb6d3c24dc

A feature for the integration outbox: the transports that send outbox entries get a way to keep their own records, such as delivery receipts. The dispatcher's interface and results stay as they are.

## HX-033
description_sha: d1cafe908ee80d7bd226e92b6cc5057a01e88279c303d33bee6e1d638aba4479

A feature for shift handover at the rental desk. The model adds a new codeunit that lists the vehicles returned during the shift and those returned damaged, with a way to clear the lists, while returns keep working as before.

## HX-034
description_sha: b5b5f75953c51f01930ca990c356c7d5f7db2d65ba3591a05a3db5cbee55f467

A feature for rental returns: import the after-hours returns that a key drop-box app sends as a JSON list, so each one is returned the same way the front desk returns a contract by hand.

## HX-035
description_sha: 7f4c95b8956153b2f15f731f5c27fe4a61397ef62894af880707652bc4708ce4

A bug fix to the group fleet availability lookup, which reports how many vehicles a named company in the group can rent out. The model corrects the count so it matches the ticket's expected behaviour.

## HX-036
description_sha: b90202e615a81582d5e82aef4905d6afe8c20031fbc1cd14f07b845dd5ef28a9

A bug fix in rental pricing and the invoice preview, around the recently shipped vehicle rate card.

## HX-037
description_sha: a4069d5934924888f7411ee0f78a120b81c0fbc50bdb95c48c02948dc6633b20

A change to the check Finance runs on a rental contract before posting it, which extensions can add to. The model must make the check report its findings as the ticket asks.

## HX-038
description_sha: 89f6de546c93632991ed51ecb4d1262e22697db554dd29d5bb6c99061de215c8

A change to lease invoicing: add a way to preview the invoice lines a run would create without creating anything, and make the real run build its lines through it so the two cannot drift apart.

## HX-039
description_sha: eb647ba30266c42414e2abc09c0ccfe59b67e10e125e153b347ce30fc593a86b

A clean-up in rental posting: add one procedure that tries to post a single contract and reports whether it worked, and have batch posting use it. Batch posting results and its error log must stay unchanged.

## HX-040
description_sha: 12fce3bc28ebbfeae2706d3ade9e6346db6bc6898cc1d18fd6ea13bc5e8e416d

A clean-up that moves the question of whether rentals are suspended from the rental app into the core app, so other apps can ask it too. Checkout and availability results must stay exactly as today.

## HX-041
description_sha: 61396e105f5d6548fc4ea4a14270c330f814e6c9643d3df565df9015524c77c4

A test-writing task for swapping a vehicle on a running rental and for returning a rental. The model writes a new test codeunit from the stated rules, judged against correct and faulty versions of the rental code.

## HX-042
description_sha: 172be8f396ff0b7114cd1faf372b195b4bc4f0f2146c044efff7380370584755

A test-writing task for how the core app gives access to the setup and the desk's chosen branch. The new test codeunit must pass on correct code and catch faulty versions.

## HX-043
description_sha: cf8a928a7c9c696e9e6a34d71a032ff9f727a2f12a4a3a4e429034b582896c59

A feature for the integration outbox: a recorded nightly run that dispatches all pending entries, which partner apps can help prepare. The model adds a new table and codeunit as specified.

## HX-044
description_sha: 5e8edd80ba97a5f314f5d3805b21e828b048dd629445e253a830bf9f1d3dc508

A feature for the working-day calendar: holidays that apply across the group. The model adds a new table and makes working-day calculations, and what is built on them, respect it.

## HX-045
description_sha: 0fa36f7f704e2f0c5c86d8d9b71d21fd74fb1c8e35de0d394f89ea512ad3bb1d

A bug fix in fleet damage handling and the workshop damage import.

## HX-046
description_sha: 147b87bf8e7b339de1c47ce932ef87a4f22ad45e6c962fab9186379c0b42f6db

A bug fix in the installments added when a lease is extended.

## HX-047
description_sha: 5b2ea3633082cb40dc389a0adc144e54ec604cd75d6560ac4bdb4f551d0078d5

A bug fix in batched outbox messages for vehicles. The model must make each queued message list the vehicles the ticket expects.

## HX-048
description_sha: 1809b8ffa409d7a8975d694c57c1d9b0a57f4cdf7d3b142e01b894b23fc6686a

A clean-up in the fleet app: one shared procedure releases a returned vehicle and records any damage it came back with, plus a new vehicle field for the last damage. The return handler uses it and returns otherwise behave as today.

## HX-049
description_sha: 8e30264a02a36d6b4eb080a047b179ad5465f6dbd43af7ff04a43b7301f91247

A feature for the integration outbox: partner apps can supply their own way of delivering outbox messages, and the customer chooses in setup which one is used. The rest of the dispatch behaviour stays as it is today.

## HX-050
description_sha: 0bc9e97255f3eeda6015d7fd777485d2bfe39380060a7ef44cc5c188c557520a

A feature for vehicle service planning: show how many days remain until a vehicle's next planned service and warn when it comes close. The existing check for whether a service is due is tidied up to reuse the new logic without changing its results.

## HX-051
description_sha: 5410f19f65c248a1455ff0fc22a8161ca0c04849d19e5a4f8b4f1481e2656add

A test-writing task for vehicle availability and rental check-out. The model writes a new test codeunit that pins down the required behaviour, passes on correct code and catches faulty versions.

## HX-052
description_sha: 56da1b047b40451938cf39ba0e522090ddb802eaf4fb9ccf902b5b2cea203e68

A test-writing task for two reporting queries: monthly revenue per vehicle and the vehicle status list. The model adds a test codeunit that must pass on the corrected queries and detect faulty ones.

## HX-053
description_sha: 20358061f2cc9ca86fb628bf307de7119008e28531bc5c6b3a6a1c7f2d4d96ae

A test-writing task for the integration outbox: queueing, marking as sent, purging and requeueing messages. The new tests must hold on correct code and expose faulty versions of it.

## HX-054
description_sha: cb75fb88e1e39e190749e88a39f0d9d70360b37ee822be7ac933464044e04c68

A test-writing task for registering and repairing vehicle damages and how that affects a vehicle's use. The model writes a test codeunit that pins the specified behaviour without changing the damage code.

## HX-055
description_sha: 18ac7523159ef66f4118c9be7a8ff25ced47e78aad579ec11aca11f75737c3cd

A feature for the rental invoice preview: the desk can keep the quoted preview of a contract and look it up again. Procedures to keep, retrieve and forget these previews are added, and the existing preview stays unchanged.

## HX-056
description_sha: 00b510ad02715cd5657b99694eb6a22a2e9b0ffa2d667b868ed810445a61503d

A feature for the integration outbox: every queued message carries a correlation number that partner systems can match to their own logs. Partner apps are given a way to see the number when the message is queued.

## HX-057
description_sha: a43acfaa4f0a164bdc40fd5cf01640e48b7d8b6c850103c39e1be84f29c3ee1f

A bug fix in the fleet utilisation report. The model must make the report produce the per-vehicle rental counts and revenue the ticket expects.

## HX-058
description_sha: ae96b18f3e10ef790ffcd89eaeb2b6c9462650afd3ce04e6bef7e7e8722ecd7f

A bug fix in the import of odometer readings from the workshop file. The import also reports how many vehicles it updated.

## HX-059
description_sha: 90286c4edffc114d242b50b3290bd20d5a10d4d92ad3c70dd55c55faf9b3070f

A bug fix in the workshop's batch repair of vehicle damages. The model must make batches and vehicle availability behave as the ticket specifies.

## HX-060
description_sha: 1bdec832eed0c91e281a9b60ff3b46b256dd6032b417ba0741a431e4815e0a87

A change to the outbox dispatcher so that a support page can see which messages the next dispatch would send. The model adds a public procedure for this and has the dispatch reuse it, with dispatch results unchanged.

## HX-061
description_sha: cde93ba7d13572c0bdc205fd9945285e2639602f24c19e74cc629ca79ca129ee

A feature for desk inspections: the desk can start an inspection once for a list of vehicles and check them out one after another, then end it. The existing single inspection check-out keeps working and is rebuilt on the new procedures.

## HX-062
description_sha: f25bf4f2d38fdcf1027646411c12e8ef8aa71f97d4c1623ac1c301c0a2f8ad01

A change to the outbox dispatcher: counting a dispatch attempt moves into one public procedure that support tools and partner apps can call as well. The dispatcher itself uses it, and dispatch otherwise works as today.

## HX-063
description_sha: 99c30cb65bfa905aaed2de28ca188cfc90c782b79803d7a58effbbffb89c416a

A test-writing task for ending a lease contract early. The model writes a new test codeunit covering the termination rules, which must pass on correct code and catch faulty versions.

## HX-064
description_sha: 2efc953f358641a49cacf41842e0cdd29ea7659d6e3443cc72ab62dba6424ca7

A test-writing task for posting rental contracts, including the points where partner apps take part in posting. The tests go in a new codeunit and must separate correct code from faulty versions.

## HX-065
description_sha: f6f764944c8092341a4fed2f5feb4c5471496530800d7132ae824a43e03587c7

A test-writing task for how rental contracts and lease contracts get their numbers. The model adds a test codeunit that pins the numbering rules without changing the numbering code.

## HX-066
description_sha: 270c4bb6fe19864864010e6d835664871aa8db5d712217b97ee4145e7538b4f4

A test-writing task for working out a vehicle's next service km from its maintenance strategy, including strategies supplied by partner apps. The tests must pass on correct code and catch faulty versions.

## HX-067
description_sha: 9ded53d8bc0aea134c0aa0911c3b284e0deeeb8d04d6cde11fd95e34634e9081

A feature for the rental desk: a basket in which the desk collects several vehicles for one customer before checking them out. The model builds a new codeunit with procedures to add, remove, list and check out the basket.

## HX-068
description_sha: 21b1c601170adb30d15dfd956a759fa92124ed7d1925c2d483c6bc764e02c9f4

A feature that closes the rental desk day in one step by posting the returned contracts. Partner apps can take part in the close.

## HX-069
description_sha: c05d4d0420b7dbeb03733b05be7b78628db594011584a3d05ba2db9d395d7ae2

A bug fix in the bulk queueing of checkout messages in the integration outbox. The model must make it produce the pending messages and count the ticket expects.

## HX-070
description_sha: 74896f58ec552c368fcb1f2b11c8c39bc7dcbbfc7e38c0163d52aa6cd13bc650

A bug fix in lease billing, in the charge for the first, partial month of a lease. The model must make that charge come out as the ticket specifies without changing how it is called.

## HX-071
description_sha: 6ac779cf99395a765d3f0f8d242f0808b632c6a74e32e1924bc6657e8bb8b665

A bug fix in registering damages on insured fleet vehicles, which insurer add-ons review. The model must make the insured registration work as the ticket describes while the existing damage procedures keep working as before.

## HX-072
description_sha: 826d05874e7a5fb07e7dc8b2af78f140728f35bcaf4343ad60ca794c909413e7

A feature for fleet damage severities: partner apps that add their own severity must be able to decide whether it blocks a vehicle. The model adds that extension point and routes damage registration and repair through it.

## HX-073
description_sha: c620ea0cacf382cc8bd17c351f305d9d2ba71f84fc80cab83db74e8445d47b5e

A change to lease invoicing so the lease desk can preview which installments an invoicing run would pick up. The selection lives in one place that both the preview and the run use.

## HX-074
description_sha: dc935c5a2e337bbf6675035bd7d4dd27f35f84730095292dadb4efd2840bcfb9

A change to the rental desk so vehicle checkout and vehicle swap share one availability check. The model adds that check and makes both operations use it, keeping their other behaviour.

## HX-075
description_sha: e4b5b36d214fe3f92152b04cf1b7ea1bea1c241eaa2616594582e2919117a174

A change to lease invoice numbering: numbers are handed out by one central procedure that partner apps can also call. The lease invoicing run is reworked to take its number from there, as the ticket specifies.

## HX-076
description_sha: ce7f8f3fa19a519560bfebdeca56aa194e7cf26511e7bb06006a611b349af9be

A test-writing task for the fleet damage overview in reporting. The model writes automated tests that pin down how the overview must behave, without fixing the code, and the tests are scored on catching faulty versions.

## HX-077
description_sha: cf564d3ef599cb68352d2398b253f89a4a4870df078bb2e81bc3b71a078a450c

A test-writing task for changing the base rate of a running lease. The model writes a test codeunit that pins down the specified behaviour and leaves the code itself untouched.

## HX-078
description_sha: 108460aff2e8ef33a103dbdbedb978f3c2f00948cde246e674c91b8e20a70de6

A test-writing task for the core procedure that splits an amount into equal shares. The model writes automated tests against the stated rules; the tests must pass on correct code and fail on faulty versions.

## HX-079
description_sha: ea74132924e94ad2abe0c016d43de808ab3bda776575156b1bd545e75db261d8

A feature for signing in to the partner portal: a new integration codeunit that signs in, keeps the portal token and lets partner apps act after each sign-in. The model builds it with the rules the ticket lays out.

## HX-080
description_sha: fe0568bda7cfc44775dd63706328126bb2bb377d3a01e5728b58f9ad92906b5c

A feature for workshop planning: a new reporting query and procedure that list the vehicles serviced in a given period.

## HX-081
description_sha: abab9bb38ce6a855e9202452c1d35c9a17169aca050b04fdbd03db947a6ee7f9

A feature for the rental desk: swapping a contract to another vehicle with an undo for the desk's last swap, and partner apps told about each desk swap. The model builds it in a new codeunit while ordinary swaps stay as they are.

## HX-082
description_sha: afb6667964d289fb517c80062c8d7caa4a6b52e497055a8c6dc445f835feab67

A bug fix in the lease payment plan import, which replaces a lease's schedule with imported lines. The model must make the import behave as the ticket states.

## HX-083
description_sha: 865318c3d2b28faed669b64e359754e81606b7d82b40ef5b5243a89286a1ec24

A bug fix in the bulk lease invoicing run and the summary it reports.

## HX-084
description_sha: d2f53d6ee6616615bfcad5ebcb36fe7a3a6c794f823e0c67f44fa19bb0ee63ff

A bug fix in the core working-day calculation that finance uses to set due dates.
## HX-085
description_sha: 3a7cfffaee1890576faa47395efe2c0e53a019c76ebada85b5e6eaf562c40614

A consolidation task in the partner portal integration: two mirrors that copy desk events to the outbox move into one new codeunit. The existing mirrors keep their procedures and work through the new one.

## HX-086
description_sha: 8bce11fa20b6a27e57da3c8c15c58cdd319da1afde50b453c5f660a1237611c4

A change to the fleet board: a general procedure that takes a snapshot of any vehicle selection for the support page. The existing board snapshots are rebuilt on top of it with the same results.

## HX-087
description_sha: a1af08f51a11ff8e64c87c66dac9f7aab4f1e849db5f9de4bfb886d63dfe7321

A change to outbox maintenance: one general purge procedure for sent messages, which the existing purge procedures then use. The model builds it to the rules the ticket gives.

## HX-088
description_sha: 52b1458bebed4b2adafa0f03b5842d63035ceb724e1fd1ebdcd867a465324b29

A test-writing task for the outbox dispatch statistics shown on the integration dashboard. The model writes automated tests that pin down how the statistics must behave, without changing the code.

## HX-089
description_sha: 4d6927958e8f9a8f48ae2e58f9f26bfbca57baf5a7851cfc72a81d6a58452d0d

A test-writing task for the lease due plan that the lease desk uses to plan collections. The model writes a test codeunit that pins down what the plan must return.

## HX-090
description_sha: beced5ad62a4e5405b8c6ce66c902691515db739acab3ac01a5a4f1ad3b61a38

A test-writing task for the lease night run that invoices leases in bulk. The model writes automated tests for the specified behaviour; they must pass on correct code and catch faulty versions.

## HX-001
description_sha: b1bf02c8b75572a28ef7f4afcea80f72b844307b47a0a9247fa2d4c0d7241f6d

A bug fix in the rental return process, for returns where the clerk records damage. The model must make such returns update the vehicle correctly while still completing the return as usual.

## HX-002
description_sha: 1b29f120024bc51192810c47eded9df9c417e3ea9792b976a3c8ef91e96f707a

A testing task for lease contracts: the model writes a new automated test codeunit that pins down how lease installment schedules must be built. The tests must pass on correct scheduling code and catch a reported fault in the current code, without changing that code.

## HX-003
description_sha: f44c5469d3c03b0a627eb7c832ca45777bb9ac11deea00ec33e269199ef35f30

A feature for vehicle service planning: vehicles that have reached their service interval must be kept away from new rentals. The rule applies to checkouts, vehicle swaps and the fleet availability check.

## HX-004
description_sha: 19cd00cc32d48e3e856be048484dd166fc3530baa13f41abb69c451ccad075ee

A reporting feature that shows what each vehicle earns from rentals and from leases over a chosen period. It adds revenue fields to the vehicle and links lease installment lines to a vehicle.

## HX-005
description_sha: 608a00dcba659deb13d037735a067b5367040715a543f8cc532c65a15ae81839

A change to rental pricing so that partner apps can add their own pricing methods without changing the rental app. The existing methods must keep their prices, and the overall price calculation and posting must keep working for every method.

## HX-006
description_sha: 27ba46ee647368ab775c0ebe5989f56b0d95942dc8fe74ca9335b59f7386c6f4

A feature for the partner portal integration: vehicle returns must also produce outbox messages, and every message for a vehicle must carry an ordering number. The model extends the message payloads and the outbox to match a stated format.

## HX-091
description_sha: a5241841d910d707cdf5417d36fb15a86692f190894110848280967f889529b3

A bug fix in the invoice dispatch queue, which sends rental invoices to customers and to the accounting partner. The model must make the queue behave as the ticket states, with resends and failure reporting still working.

## HX-092
description_sha: 174e9b78b7f6dda30f5e8f98ccef626ccdd4ad90aabc57106af0db5ebd36258e

A feature for corporate billing: matching several selected contract day lines against one monthly billing line should link the ones that fit, in one step. Single-line matching stays as it is.

## HX-093
description_sha: 78055e3a7036e9f70dbe9127d4cbd91c51c82bb1049ab13a8ebf4fcdb202a5b7

A bug fix in posting rental contracts that are paid by card. The model must change posting and the contract check as the ticket asks, while contracts that post correctly today stay unchanged.

## HX-094
description_sha: cfaffd1d68d2e9c66d1438f7a0aff045715a6393c84848a10737040508234231

A bug fix in the rental invoice summary sent to the e-invoicing partner.

## HX-095
description_sha: 5e692abcad2f33bb82680176501f0ad8bcbf4db3c8b3f17938435925dc9ac5c6

A bug fix in the payment export lines sent to the accounting partner. The model must make reapplying, refreshing and rebuilding payments follow the rules the ticket states.

## HX-096
description_sha: a3cfd414648369507b09f69387ac3f93904af4e3895497047efbb5ff666ff8c5

A bug fix in the monthly vehicle owner payout proposal, for statements that carry third-party shares. The model must apply a product owner decision on how those shares affect the owner's payout line and when it may be paid.

## HX-097
description_sha: 6065bf8f94b6a51f5c6df6ee3de81d9c491f7d7e4094d6e638b967dafb369451

A refactoring of the rental approvals list: the part that adds approvals shared by colleagues moves into its own public procedure, as the ticket describes.

## HX-098
description_sha: 3714f68be0043982d9682e5dc936cd552f9994550f3d8306c681c461163f890c

A feature that adds boats as a new kind of rental fleet asset alongside cars and vans. The model must work the new asset through rentals, pricing, servicing and the other parts of the application, with the differences the ticket lists.
