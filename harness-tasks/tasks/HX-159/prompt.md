# Task 5159: Automated tests for the lease invoice proposal

Reported by the Lease desk.

Each month the desk proposes the lease installments that are due (`CGR Lease Proposing`.`Propose`), and clerks tidy the proposal list before it is invoiced. When a clerk removes a proposed line by mistake, that month is never proposed again.

Before anyone changes the proposal we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the proposal must behave (`CGR Lease Proposing` in Leasing, procedures `Propose(ContractNo: Code[20]; UpToDate: Date): Integer` and `PostProposal(ContractNo: Code[20]; ScheduleLineNo: Integer)`):

Propose writes one `CGR Lease Proposal Line` for every schedule line of the lease that is not invoiced, is due on or before UpToDate and has no proposal line yet, returns the number of lines it wrote, and leaves the lease's "Proposed Through" at UpToDate unless it was already later. A proposed line that a clerk removes from the list is proposed again by the next Propose that reaches its due date, because removing it sets that lease's "Proposed Through", and never that of another lease of the same customer, back to the day before the line's due date if it is not already earlier. PostProposal marks the schedule line invoiced and takes the proposal line off the list, leaves "Proposed Through" as it is, and a posted month is never proposed again.

Current code:

```al
// Leasing
table 70381 "CGR Lease Proposal Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { }
        field(2; "Schedule Line No."; Integer) { }
        field(3; "Due Date"; Date) { }
        field(4; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Contract No.", "Schedule Line No.") { Clustered = true; }
    }

    trigger OnDelete()
    var
        Contract: Record "CGR Lease Contract";
    begin
        Contract.Get("Contract No.");
        if Contract."Proposed Through" >= "Due Date" then begin
            Contract."Proposed Through" := "Due Date";
            Contract.Modify();
        end;
    end;
}

codeunit 70382 "CGR Lease Proposing"
{
    procedure Propose(ContractNo: Code[20]; UpToDate: Date): Integer
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Proposal: Record "CGR Lease Proposal Line";
        Created: Integer;
    begin
        Contract.Get(ContractNo);
        if Contract."Proposed Through" >= UpToDate then
            exit(0);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        if Contract."Proposed Through" = 0D then
            ScheduleLine.SetFilter("Due Date", '..%1', UpToDate)
        else
            ScheduleLine.SetFilter("Due Date", '%1..%2', Contract."Proposed Through" + 1, UpToDate);
        if ScheduleLine.FindSet() then
            repeat
                if not Proposal.Get(ContractNo, ScheduleLine."Line No.") then begin
                    Proposal.Init();
                    Proposal."Contract No." := ContractNo;
                    Proposal."Schedule Line No." := ScheduleLine."Line No.";
                    Proposal."Due Date" := ScheduleLine."Due Date";
                    Proposal.Amount := ScheduleLine.Amount;
                    Proposal.Insert();
                    Created += 1;
                end;
            until ScheduleLine.Next() = 0;
        Contract."Proposed Through" := UpToDate;
        Contract.Modify();
        exit(Created);
    end;

    procedure PostProposal(ContractNo: Code[20]; ScheduleLineNo: Integer)
    var
        Proposal: Record "CGR Lease Proposal Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        Proposal.Get(ContractNo, ScheduleLineNo);
        LeaseMgt.InvoiceLine(ContractNo, ScheduleLineNo);
        Proposal.Delete();
    end;
}

// CGR Lease Contract gets "Proposed Through" (Date).
// CGR Lease Mgt (Leasing): CreateContract(VehicleNo; CustomerName; StartDate; Months; BaseRate): Code[20],
//   CreateSchedule(ContractNo): one line per month, "Line No." 10000, 20000, ..., "Due Date" = start date, +1 month, ...
// Test codeunits use Subtype = Test, TestPermissions = Disabled and codeunit "Library Assert"; they run
// through the standard test runner with TestIsolation = Codeunit.
```

Write the test codeunit and explain briefly which fault each test catches.
