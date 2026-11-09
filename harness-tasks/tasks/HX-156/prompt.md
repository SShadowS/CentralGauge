# Task 5156: Automated tests for the repair estimate worksheet

Reported by the Workshop desk.

The total on a repair estimate shows the money of estimates approved earlier, not the lines the clerk has on screen.

Before anyone changes the worksheet we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app, plus any helper codeunits your tests need. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the worksheet must behave (`CGR Repair Estimate Session` in Fleet; `CGR Repair Estimate Apply` raises `OnAfterEstimateApplied(VehicleNo: Code[20]; Total: Decimal)`):

- A clerk builds an estimate in the session, nothing is stored while building. `AddEstimateLine` adds one line and returns its Line No.: 1, 2, 3 and so on per vehicle. Every line added stays on the estimate.
- A new line gets the work date in "Created On".
- `Total(VehicleNo)` is the sum of the session's lines of that vehicle, and nothing else.
- `GetEstimateLines` hands the session's lines to the worksheet page. The page works on the session's own lines: a line deleted through the record GetEstimateLines filled is gone from the estimate.
- `Apply(VehicleNo): Boolean` stores the vehicle's lines as approved estimate lines, one `CGR Repair Estimate Line` row each, and returns true; afterwards the session has no lines left for that vehicle.
- The workshop app may refuse (an error in OnAfterEstimateApplied). Then Apply returns false, no approved line is stored, and the estimate is still in the session unchanged, so the clerk can try again.
- `Reset` empties the session.
- Apply is started from the worksheet page after everything before it has been committed.

Current code:

```al
// Fleet
table 70130 "CGR Repair Estimate Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { }
        field(3; "Line No."; Integer) { }
        field(4; Description; Text[50]) { }
        field(5; Amount; Decimal) { }
        field(6; "Created On"; Date) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }

    trigger OnInsert()
    begin
        "Created On" := WorkDate();
    end;
}

codeunit 70130 "CGR Repair Estimate Session"
{
    SingleInstance = true;

    var
        TempLine: Record "CGR Repair Estimate Line" temporary;
        LastEntryNo: Integer;

    procedure AddEstimateLine(VehicleNo: Code[20]; Description: Text[50]; Amount: Decimal): Integer
    var
        LineNo: Integer;
    begin
        TempLine.Reset();
        TempLine.SetRange("Vehicle No.", VehicleNo);
        if TempLine.FindLast() then
            LineNo := TempLine."Line No.";
        LineNo += 1;
        TempLine.Reset();
        LastEntryNo += 1;
        TempLine.Init();
        TempLine."Entry No." := LastEntryNo;
        TempLine."Vehicle No." := VehicleNo;
        TempLine."Line No." := LineNo;
        TempLine.Description := Description;
        TempLine.Amount := Amount;
        TempLine.Insert(true);
        exit(LineNo);
    end;

    procedure GetEstimateLines(var Lines: Record "CGR Repair Estimate Line" temporary)
    begin
        TempLine.Reset();
        Lines.Copy(TempLine, true);
    end;

    procedure Total(VehicleNo: Code[20]): Decimal
    begin
        exit(SumEstimateLines(TempLine, VehicleNo));
    end;

    procedure Apply(VehicleNo: Code[20]): Boolean
    var
        Vehicle: Record "CGR Vehicle";
        Applier: Codeunit "CGR Repair Estimate Apply";
    begin
        Vehicle.Get(VehicleNo);
        Applier.SetApplyVehicle(VehicleNo);
        TempLine.Reset();
        if not Applier.Run(TempLine) then
            exit(false);
        TempLine.Reset();
        TempLine.SetRange("Vehicle No.", VehicleNo);
        TempLine.DeleteAll();
        exit(true);
    end;

    procedure Reset()
    begin
        TempLine.Reset();
        TempLine.DeleteAll();
        LastEntryNo := 0;
    end;

    local procedure SumEstimateLines(Lines: Record "CGR Repair Estimate Line"; VehicleNo: Code[20]) Result: Decimal
    begin
        Lines.SetRange("Vehicle No.", VehicleNo);
        if Lines.FindSet() then
            repeat
                Result += Lines.Amount;
            until Lines.Next() = 0;
    end;
}

codeunit 70131 "CGR Repair Estimate Apply"
{
    TableNo = "CGR Repair Estimate Line";

    var
        ApplyVehicleNo: Code[20];

    procedure SetApplyVehicle(VehicleNo: Code[20])
    begin
        ApplyVehicleNo := VehicleNo;
    end;

    trigger OnRun()
    var
        Approved: Record "CGR Repair Estimate Line";
        Total: Decimal;
    begin
        Rec.SetRange("Vehicle No.", ApplyVehicleNo);
        if Rec.FindSet() then
            repeat
                Approved.Init();
                Approved."Entry No." := 0;
                Approved."Vehicle No." := Rec."Vehicle No.";
                Approved."Line No." := Rec."Line No.";
                Approved.Description := Rec.Description;
                Approved.Amount := Rec.Amount;
                Approved.Insert(true);
                Total += Rec.Amount;
            until Rec.Next() = 0;
        OnAfterEstimateApplied(ApplyVehicleNo, Total);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterEstimateApplied(VehicleNo: Code[20]; Total: Decimal)
    begin
    end;
}

// Test app helpers you may use (codeunit 80090 "CGR Test Library", EventSubscriberInstance = Manual):
//   CreateVehicle(VehicleNo; Mileage; Strategy)
// Test codeunits use Subtype = Test, TestPermissions = Disabled and codeunit "Library Assert"; they run
// through the standard test runner with TestIsolation = Codeunit.
```

Write the test codeunit and any helper codeunits, and explain briefly which fault each test catches.
