# Feature 5173: Propose the workshop tasks of a vehicle

Requested by Workshop planning.

Workshop planning plans its work as workshop tasks (`CGR Workshop Task`, Fleet) through `CGR Workshop Planning`. Today the planner looks up by hand which vehicles are due for service and which have damage to repair. They want the system to propose the tasks instead: the planner goes through the vehicles, collects a proposal for each one into the same list, reviews the list and then accepts it with `AcceptWorkshopProposal`, which plans the lines in the order of the list.

Add to `CGR Workshop Planning`: `procedure ProposeWorkshopTasks(VehicleNo: Code[20]; AtDate: Date; var Proposal: Record "CGR Workshop Task" temporary): Integer`. It adds the vehicle's proposed tasks to Proposal and returns the number of lines it added.

Contract: a vehicle that is due for service on AtDate (`CGR Service Plan Mgt`.`IsServiceDue`) gets a Service line with Description `Service due` and no "Damage Entry No.", and each unrepaired damage entry of the vehicle gets a Repair line with that entry's number in "Damage Entry No." and its Description; every line carries the vehicle's number in "Vehicle No.". A vehicle that needs several things gets one line for each of them, the Service line first and then the Repair lines in damage entry order, so a vehicle due for service with two unrepaired damages gets three lines. A vehicle with nothing to do adds no line and returns 0. Lines already in Proposal, from vehicles proposed earlier, stay as they are, and the new lines come after them.

Keep the public procedures of `CGR Workshop Planning` as they are.
