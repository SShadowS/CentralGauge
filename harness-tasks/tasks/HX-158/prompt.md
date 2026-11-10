# Task 5158: Automated tests for contract cancellation

Reported by Accounts receivable.

When the desk waives the fee as a goodwill gesture, the customer still shows up everywhere as if the fee had been charged.

Before anyone changes the cancellation we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app, plus any helper codeunits your tests need. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the cancellation must behave (`CGR Contract Cancellation` in Rental, procedure `CancelContract(ContractNo: Code[20]; CancelDate: Date; Waive: Boolean): Boolean`; `CGR Cancellation Run` raises `OnAfterCancellationCompleted(Entry: Record "CGR Cancellation Entry")`; `CGR Cancellation Reporting` in Reporting has `BranchTotals(BranchCode: Code[10]; var FeeTotal: Decimal; var Cancellations: Integer)`):

- A cancellation writes one `CGR Cancellation Entry` for the contract with its Branch Code, Waived and Fee Amount, and CancelContract returns true. A contract is cancelled once: a second call writes nothing and returns false. Only an Open contract can be cancelled.
- The fee: the rental value is the vehicle's Daily Rate x the contract's days (End Date - Start Date + 1). Cancelled 7 days or more before the Start Date, the fee is 0; 3 to 6 days before, half the rental value; less than 3 days before, the whole rental value. Rounded to 0.01.
- Accounting gets one `CGR Rental Ledger Entry` for the contract with Amount = the fee, also when the fee is 0 under the 7-day rule. The partners get one `CGR Cancellation Message` with the fee, also then. BranchTotals counts the cancellation and adds its fee.
- A waived cancellation (Waive = true) is still a cancellation and keeps its entry, with Waived set. It costs the customer nothing and counts nowhere in the money: Fee Amount 0, no ledger entry, no partner message, and BranchTotals does not count it.
- A partner app may refuse a cancellation (an error in OnAfterCancellationCompleted). Then CancelContract returns false and one `CGR Cancellation Failure` holds the contract number and the partner's error text; nothing else of the refused cancellation is kept (no entry, ledger entry or message).
- Cancellations are started from the contract list, with no unsaved changes.

Current code:

```al
// Rental
table 70280 "CGR Cancellation Entry"
{
    DataClassification = CustomerContent;
    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { }
        field(3; "Branch Code"; Code[10]) { }
        field(4; "Fee Amount"; Decimal) { }
        field(5; Waived; Boolean) { }
    }
    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}

// "CGR Cancellation Message": "Entry No." (AutoIncrement), "Contract No.", "Fee Amount".
// "CGR Cancellation Failure": "Entry No." (AutoIncrement), "Contract No.", "Error Message" (Text[250]).

codeunit 70280 "CGR Contract Cancellation"
{
    procedure CancelContract(ContractNo: Code[20]; CancelDate: Date; Waive: Boolean): Boolean
    var
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Cancellation Entry";
        Failure: Record "CGR Cancellation Failure";
        CancelRun: Codeunit "CGR Cancellation Run";
    begin
        Contract.Get(ContractNo);
        Entry.SetRange("Contract No.", ContractNo);
        if not Entry.IsEmpty() then
            exit(false);
        CancelRun.SetCancellation(CancelDate, Waive);
        ClearLastError();
        if CancelRun.Run(Contract) then
            exit(true);
        Failure.Init();
        Failure."Contract No." := ContractNo;
        Failure."Error Message" := CopyStr(GetLastErrorText(), 1, MaxStrLen(Failure."Error Message"));
        Failure.Insert(true);
        Commit();
        exit(false);
    end;
}

codeunit 70281 "CGR Cancellation Run"
{
    TableNo = "CGR Rental Contract";

    var
        CancelOn: Date;
        WaiveFee: Boolean;
        NotOpenErr: Label 'Rental contract %1 is not open.', Comment = '%1 = contract number';

    procedure SetCancellation(CancelDate: Date; Waive: Boolean)
    begin
        CancelOn := CancelDate;
        WaiveFee := Waive;
    end;

    trigger OnRun()
    var
        Entry: Record "CGR Cancellation Entry";
        FeeCalc: Codeunit "CGR Cancellation Fee";
    begin
        if Rec.Status <> Rec.Status::Open then
            Error(NotOpenErr, Rec."No.");
        Entry.Init();
        Entry."Contract No." := Rec."No.";
        Entry."Branch Code" := Rec."Branch Code";
        Entry.Waived := WaiveFee;
        Entry."Fee Amount" := FeeCalc.CalcCancellationFee(Rec, CancelOn, WaiveFee);
        Entry.Insert(true);
        OnAfterCancellationWritten(Entry);
        OnAfterCancellationCompleted(Entry);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCancellationWritten(Entry: Record "CGR Cancellation Entry")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCancellationCompleted(Entry: Record "CGR Cancellation Entry")
    begin
    end;
}

codeunit 70282 "CGR Cancellation Fee"
{
    procedure CalcCancellationFee(Contract: Record "CGR Rental Contract"; CancelDate: Date; Waive: Boolean): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        RentalValue: Decimal;
        DaysBefore: Integer;
    begin
        Vehicle.Get(Contract."Vehicle No.");
        RentalValue := Vehicle."Daily Rate" * (Contract."End Date" - Contract."Start Date" + 1);
        DaysBefore := Contract."Start Date" - CancelDate;
        if DaysBefore >= 7 then
            exit(0);
        if DaysBefore >= 3 then
            exit(Round(RentalValue / 2, 0.01));
        exit(Round(RentalValue, 0.01));
    end;
}

codeunit 70283 "CGR Cancellation Ledger"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Cancellation Run", 'OnAfterCancellationWritten', '', false, false)]
    local procedure WriteLedgerEntry(Entry: Record "CGR Cancellation Entry")
    var
        Contract: Record "CGR Rental Contract";
        PostLedger: Codeunit "CGR Rental-Post Ledger";
    begin
        Contract.Get(Entry."Contract No.");
        PostLedger.InsertEntry(Contract, Entry."Fee Amount");
    end;
}

codeunit 70284 "CGR Cancellation Partner Queue"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Cancellation Run", 'OnAfterCancellationWritten', '', false, false)]
    local procedure QueueCancellationNotice(Entry: Record "CGR Cancellation Entry")
    var
        Notice: Record "CGR Cancellation Message";
    begin
        Notice.Init();
        Notice."Contract No." := Entry."Contract No.";
        Notice."Fee Amount" := Entry."Fee Amount";
        Notice.Insert(true);
    end;
}

// Reporting
query 70534 "CGR Branch Cancellations"
{
    QueryType = Normal;

    elements
    {
        dataitem(Entry; "CGR Cancellation Entry")
        {
            column(BranchCode; "Branch Code") { }
            column(FeeTotal; "Fee Amount") { Method = Sum; }
            column(Cancellations) { Method = Count; }
        }
    }
}

codeunit 70534 "CGR Cancellation Reporting"
{
    procedure BranchTotals(BranchCode: Code[10]; var FeeTotal: Decimal; var Cancellations: Integer)
    var
        Totals: Query "CGR Branch Cancellations";
    begin
        FeeTotal := 0;
        Cancellations := 0;
        Totals.SetRange(BranchCode, BranchCode);
        Totals.Open();
        if Totals.Read() then begin
            FeeTotal := Totals.FeeTotal;
            Cancellations := Totals.Cancellations;
        end;
        Totals.Close();
    end;
}

// Test app helpers you may use (codeunit 80090 "CGR Test Library", EventSubscriberInstance = Manual):
//   CreateVehicle(VehicleNo; Mileage; Strategy); SetDailyRate(VehicleNo; DailyRate);
//   CreateContract(VehicleNo): Code[20] (Start Date 2027-03-01, End Date 2027-03-03, status Open)
// Test codeunits use Subtype = Test, TestPermissions = Disabled and codeunit "Library Assert"; they run
// through the standard test runner with TestIsolation = Codeunit.
```

Write the test codeunit and any helper codeunits, and explain briefly which fault each test catches.
