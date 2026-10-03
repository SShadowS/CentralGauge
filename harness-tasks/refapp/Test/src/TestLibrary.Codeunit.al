codeunit 80090 "CGR Test Library"
{
    EventSubscriberInstance = Manual;

    var
        FailAfterCommitContractNo: Code[20];
        RejectedVehicleNo: Code[20];
        LeaseInvoiceLinesHandled: Boolean;
        LeaseInvoiceLinesCreated: Integer;
        SimulatedFailureErr: Label 'Simulated failure after commit for %1.', Comment = '%1 = contract number';
        RejectedErr: Label 'Endpoint rejected vehicle %1.', Comment = '%1 = vehicle number';

    procedure CreateVehicle(VehicleNo: Code[20]; Mileage: Integer; Strategy: Enum "CGR Maintenance Strategy")
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Strategy;
        Vehicle.Insert();
    end;

    procedure SetLastServiceKm(VehicleNo: Code[20]; LastServiceKm: Integer)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle."Last Service Km" := LastServiceKm;
        Vehicle.Modify();
    end;

    procedure SetDailyRate(VehicleNo: Code[20]; DailyRate: Decimal)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Modify();
    end;

    procedure SetPricing(WeekendSurchargePct: Decimal; KmAllowancePerDay: Integer; ExcessKmRate: Decimal)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := WeekendSurchargePct;
        Setup."Km Allowance per Day" := KmAllowancePerDay;
        Setup."Excess Km Rate" := ExcessKmRate;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    procedure CreateContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContract(VehicleNo, 'Test Customer', 20270301D, 20270303D));
    end;

    procedure CreateLease(VehicleNo: Code[20]; StartDate: Date; Months: Integer; BaseRate: Decimal): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        exit(LeaseMgt.CreateContract(VehicleNo, 'Test Customer', StartDate, Months, BaseRate));
    end;

    procedure SetV2Setup(RoundingPrecision: Decimal; DefaultBranchCode: Code[10]; OutboxMaxAttempts: Integer)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := RoundingPrecision;
        Setup."Default Branch Code" := DefaultBranchCode;
        Setup."Outbox Max Attempts" := OutboxMaxAttempts;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    procedure ClearNonWorkingDays(FromDate: Date; ToDate: Date)
    var
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        NonWorkingDay.SetRange("Non-Working Date", FromDate, ToDate);
        NonWorkingDay.DeleteAll();
    end;

    procedure AddNonWorkingDay(NonWorkingDate: Date)
    var
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        if NonWorkingDay.Get(NonWorkingDate) then
            exit;
        NonWorkingDay.Init();
        NonWorkingDay."Non-Working Date" := NonWorkingDate;
        NonWorkingDay.Description := 'Test holiday';
        NonWorkingDay.Insert();
    end;

    procedure CreateServicePlan(PlanCode: Code[20]; Strategy: Enum "CGR Maintenance Strategy"; IntervalMonths: Integer)
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
        ServicePlan.Init();
        ServicePlan.Code := PlanCode;
        ServicePlan.Description := 'Test plan';
        ServicePlan.Strategy := Strategy;
        ServicePlan."Interval Months" := IntervalMonths;
        ServicePlan.Insert();
    end;

    procedure CreateReturnedContract(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; ReturnKm: Integer): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'Test Customer', StartDate, EndDate);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, ReturnKm, '');
        exit(ContractNo);
    end;

    procedure ClearOutbox(VehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
    end;

    procedure QueueOutboxEntry(VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleCheckedOut(VehicleNo);
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.FindLast();
        exit(Entry."Entry No.");
    end;

    procedure InsertLedgerEntry(VehicleNo: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        Entry: Record "CGR Rental Ledger Entry";
    begin
        Entry.Init();
        Entry."Vehicle No." := VehicleNo;
        Entry."Posting Date" := PostingDate;
        Entry.Amount := Amount;
        Entry.Insert();
    end;

    procedure ClearLedgerEntries(VehicleNo: Code[20])
    var
        Entry: Record "CGR Rental Ledger Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
    end;

    procedure FailPostingAfterCommit(ContractNo: Code[20])
    begin
        FailAfterCommitContractNo := ContractNo;
    end;

    procedure RejectOutboxVehicle(VehicleNo: Code[20])
    begin
        RejectedVehicleNo := VehicleNo;
    end;

    procedure HandleLeaseInvoiceLines(Handled: Boolean)
    begin
        LeaseInvoiceLinesHandled := Handled;
    end;

    procedure LeaseInvoiceLinesSeen(): Integer
    begin
        exit(LeaseInvoiceLinesCreated);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure FailAfterCommit(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        if (FailAfterCommitContractNo = '') or (RentalContract."No." <> FailAfterCommitContractNo) then
            exit;
        Commit();
        Error(SimulatedFailureErr, RentalContract."No.");
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Dispatcher", 'OnSendEntry', '', false, false)]
    local procedure DeliverOutboxEntry(Entry: Record "CGR Outbox Entry"; var Delivered: Boolean)
    begin
        if (RejectedVehicleNo <> '') and (Entry."Vehicle No." = RejectedVehicleNo) then
            Error(RejectedErr, Entry."Vehicle No.");
        Delivered := true;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnBeforeCreateInvoiceLine', '', false, false)]
    local procedure HandleLeaseInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
        IsHandled := LeaseInvoiceLinesHandled;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure CountLeaseInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    begin
        LeaseInvoiceLinesCreated += 1;
    end;
}
