codeunit 87955 "HX133 Repricing Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        BlockedTxt: Label 'Vehicle %1 is blocked; open contract %2 cannot be changed.', Locked = true;

    [Test]
    procedure RepricesOpenContracts()
    var
        Repricing: Codeunit "CGR Contract Repricing";
        Repriced: Integer;
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V1A', 123.45, false);
        MakeVehicleHX133('HX133-V1B', 80, false);
        MakeVehicleHX133('HX133-V1C', 50.5, false);
        MakeVehicleHX133('HX133-V1D', 70, false);
        MakeContractHX133('HX133-1A', 'HX133-V1A', 'HX133B1A', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-1B', 'HX133-V1B', 'HX133B1A', Enum::"CGR Rental Status"::Open, 2);
        MakeContractHX133('HX133-1C', 'HX133-V1C', 'HX133B1B', Enum::"CGR Rental Status"::Open, 3);
        MakeContractHX133('HX133-1D', 'HX133-V1D', 'HX133B1C', Enum::"CGR Rental Status"::Returned, 10);
        MakeVehicleHX133('HX133-V1E', 90, false);
        MakeContractHX133('HX133-1E', 'HX133-V1E', 'HX133B1D', Enum::"CGR Rental Status"::"Checked Out", 20);
        Commit();

        Repriced := Repricing.RepriceOpenContracts(1.1);

        Assert.AreEqual(3, Repriced, 'RepriceOpenContracts returns the number of contracts it re-priced');
        Assert.AreEqual(135.80, AgreedRateHX133('HX133-1A'), 'Daily Rate 123.45 times 1.1, rounded to 0.01');
        Assert.AreEqual(88.00, AgreedRateHX133('HX133-1B'), 'Daily Rate 80 times 1.1');
        Assert.AreEqual(55.55, AgreedRateHX133('HX133-1C'), 'Daily Rate 50.5 times 1.1');
        Assert.AreEqual(10, AgreedRateHX133('HX133-1D'), 'A contract that is not Open is not re-priced');
        Assert.AreEqual(20, AgreedRateHX133('HX133-1E'), 'A Checked Out contract is not re-priced');
    end;

    [Test]
    procedure NoContractChangedWhileRepricing()
    var
        Repricing: Codeunit "CGR Contract Repricing";
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V2A', 100, false);
        MakeVehicleHX133('HX133-V2B', 60, false);
        MakeVehicleHX133('HX133-V2C', 40, false);
        MakeContractHX133('HX133-2A', 'HX133-V2A', 'HX133B2A', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-2B', 'HX133-V2B', 'HX133B2A', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-2C', 'HX133-V2C', 'HX133B2B', Enum::"CGR Rental Status"::Open, 1);
        Commit();

        Repricing.RepriceOpenContracts(1.1);

        Assert.AreEqual(0, CountMessagesHX133('contractChanged', 'HX133-V2A'), 'A re-pricing queues no contractChanged message (2A)');
        Assert.AreEqual(0, CountMessagesHX133('contractChanged', 'HX133-V2B'), 'A re-pricing queues no contractChanged message (2B)');
        Assert.AreEqual(0, CountMessagesHX133('contractChanged', 'HX133-V2C'), 'A re-pricing queues no contractChanged message (2C)');
    end;

    [Test]
    procedure OneRatesChangedPerBranch()
    var
        Repricing: Codeunit "CGR Contract Repricing";
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V3A', 100, false);
        MakeVehicleHX133('HX133-V3B', 60, false);
        MakeVehicleHX133('HX133-V3C', 40, false);
        MakeVehicleHX133('HX133-V3D', 30, false);
        MakeContractHX133('HX133-3A', 'HX133-V3A', 'HX133B3A', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-3B', 'HX133-V3B', 'HX133B3A', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-3C', 'HX133-V3C', 'HX133B3B', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-3D', 'HX133-V3D', 'HX133B3C', Enum::"CGR Rental Status"::Returned, 1);
        Commit();

        Repricing.RepriceOpenContracts(1.1);

        Assert.AreEqual(1, CountRatesChangedHX133('HX133B3A'), 'One ratesChanged message for a branch with two re-priced contracts');
        Assert.AreEqual(1, CountRatesChangedHX133('HX133B3B'), 'One ratesChanged message for a branch with one re-priced contract');
        Assert.AreEqual(0, CountRatesChangedHX133('HX133B3C'), 'No ratesChanged message for a branch without re-priced contracts');
    end;

    [Test]
    procedure SaveSideEffectsKept()
    var
        ChangeLog: Record "CGR Contract Change Log";
        Repricing: Codeunit "CGR Contract Repricing";
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V4A', 100, false);
        MakeVehicleHX133('HX133-V4B', 60, false);
        MakeVehicleHX133('HX133-V4C', 40, false);
        MakeContractHX133('HX133-4A', 'HX133-V4A', 'HX133B4A', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-4B', 'HX133-V4B', 'HX133B4B', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-4C', 'HX133-V4C', 'HX133B4A', Enum::"CGR Rental Status"::Returned, 1);
        Commit();

        Repricing.RepriceOpenContracts(1.1);

        ChangeLog.SetRange("Contract No.", 'HX133-4A');
        Assert.AreEqual(1, ChangeLog.Count(), 'Saving a re-priced contract does what a contract save does (4A)');
        ChangeLog.FindFirst();
        Assert.AreEqual(20270301D, ChangeLog."Changed On", 'The save of 4A is logged on the work date');
        ChangeLog.SetRange("Contract No.", 'HX133-4B');
        Assert.AreEqual(1, ChangeLog.Count(), 'Saving a re-priced contract does what a contract save does (4B)');
        ChangeLog.SetRange("Contract No.", 'HX133-4C');
        Assert.AreEqual(0, ChangeLog.Count(), 'A contract that is not re-priced is not saved');
    end;

    [Test]
    procedure BlockedVehicleFails()
    var
        Runner: Codeunit "HX133 Repricing Runner";
        Ok: Boolean;
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V5A', 100, false);
        MakeVehicleHX133('HX133-V5B', 60, true);
        MakeContractHX133('HX133-5A', 'HX133-V5A', 'HX133B5A', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-5B', 'HX133-V5B', 'HX133B5A', Enum::"CGR Rental Status"::Open, 1);
        Commit();

        Runner.SetHX133Factor(1.1);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A re-pricing that reaches a contract on a blocked vehicle stops');
        Assert.AreEqual(StrSubstNo(BlockedTxt, 'HX133-V5B', 'HX133-5B'), GetLastErrorText(), 'The re-pricing stops with the save''s error');
        Assert.AreEqual(1, AgreedRateHX133('HX133-5B'), 'A contract that cannot be changed is not re-priced');
    end;

    [Test]
    procedure ChangeAfterFailedRepricingQueues()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "HX133 Repricing Runner";
        Ok: Boolean;
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V6A', 100, false);
        MakeVehicleHX133('HX133-V6B', 60, true);
        MakeContractHX133('HX133-6A', 'HX133-V6A', 'HX133B6A', Enum::"CGR Rental Status"::Open, 1);
        MakeContractHX133('HX133-6B', 'HX133-V6B', 'HX133B6A', Enum::"CGR Rental Status"::Open, 1);
        Commit();

        Runner.SetHX133Factor(1.1);
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'Precondition: the re-pricing stops on the blocked vehicle');

        Contract.Get('HX133-6A');
        Contract."End Date" := 20270310D;
        Contract.Modify(true);

        Assert.AreEqual(1, CountMessagesHX133('contractChanged', 'HX133-V6A'), 'A contract change after a failed re-pricing queues its message');
        Assert.AreEqual(1, CountPayloadHX133('contractChanged', 'HX133-V6A', 'HX133-6A'), 'The message names the changed contract');
    end;

    [Test]
    procedure ChangeAfterRepricingQueues()
    var
        Contract: Record "CGR Rental Contract";
        Repricing: Codeunit "CGR Contract Repricing";
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V7A', 100, false);
        MakeContractHX133('HX133-7A', 'HX133-V7A', 'HX133B7A', Enum::"CGR Rental Status"::Open, 1);
        Commit();

        Repricing.RepriceOpenContracts(1.1);

        Contract.Get('HX133-7A');
        Contract."End Date" := 20270310D;
        Contract.Modify(true);

        Assert.AreEqual(1, CountMessagesHX133('contractChanged', 'HX133-V7A'), 'A contract change after a re-pricing queues its message');
        Assert.AreEqual(1, CountPayloadHX133('contractChanged', 'HX133-V7A', 'HX133-7A'), 'The message names the changed contract');
    end;

    [Test]
    procedure NothingOpenNothingQueued()
    var
        ChangeLog: Record "CGR Contract Change Log";
        Repricing: Codeunit "CGR Contract Repricing";
        Repriced: Integer;
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V8A', 100, false);
        MakeContractHX133('HX133-8A', 'HX133-V8A', 'HX133B8A', Enum::"CGR Rental Status"::Returned, 10);
        Commit();

        Repriced := Repricing.RepriceOpenContracts(1.1);

        Assert.AreEqual(0, Repriced, 'With no Open contract nothing is re-priced');
        Assert.AreEqual(10, AgreedRateHX133('HX133-8A'), 'The returned contract keeps its rate');
        Assert.AreEqual(0, CountRatesChangedHX133('HX133B8A'), 'No ratesChanged message without re-priced contracts');
        ChangeLog.SetRange("Contract No.", 'HX133-8A');
        Assert.AreEqual(0, ChangeLog.Count(), 'The returned contract is not saved');
    end;

    [Test]
    procedure BookingImportSkipsBlockCheck()
    var
        Contract: Record "CGR Rental Contract";
        PartnerContract: Record "CGR Rental Contract" temporary;
        BookingImport: Codeunit "CGR Booking Import";
        Applied: Integer;
    begin
        InitHX133();
        MakeVehicleHX133('HX133-V9A', 100, true);
        MakeContractHX133('HX133-9A', 'HX133-V9A', 'HX133B9A', Enum::"CGR Rental Status"::Open, 1);
        Commit();

        PartnerContract.Init();
        PartnerContract."No." := 'HX133-9A';
        PartnerContract."End Date" := 20270320D;
        PartnerContract.Insert();
        Applied := BookingImport.ApplyPartnerEndDates(PartnerContract);

        Assert.AreEqual(1, Applied, 'The booking import applies the partner change');
        Contract.Get('HX133-9A');
        Assert.AreEqual(20270320D, Contract."End Date", 'The booking import changes a contract on a blocked vehicle as today');
        Assert.AreEqual(0, CountMessagesHX133('contractChanged', 'HX133-V9A'), 'The booking import stays quiet as today');
    end;

    local procedure InitHX133()
    var
        Contract: Record "CGR Rental Contract";
        Silencer: Codeunit "CGR Integration Silencer";
    begin
        WorkDate(20270301D);
        Silencer.ResumeMessages();
        Contract.SetRange(Status, Contract.Status::Open);
        Contract.DeleteAll();
    end;

    local procedure MakeVehicleHX133(VehicleNo: Code[20]; DailyRate: Decimal; IsBlocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Blocked := IsBlocked;
        Vehicle.Insert();
    end;

    local procedure MakeContractHX133(ContractNo: Code[20]; VehicleNo: Code[20]; BranchCode: Code[10]; Status: Enum "CGR Rental Status"; AgreedRate: Decimal)
    var
        Contract: Record "CGR Rental Contract";
        ChangeLog: Record "CGR Contract Change Log";
        Entry: Record "CGR Outbox Entry";
    begin
        if Contract.Get(ContractNo) then
            Contract.Delete();
        ChangeLog.SetRange("Contract No.", ContractNo);
        ChangeLog.DeleteAll();
        Entry.SetRange("Event Type", 'ratesChanged');
        Entry.SetRange(Payload, BranchCode);
        Entry.DeleteAll();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX133 customer';
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270305D;
        Contract.Status := Status;
        Contract."Branch Code" := BranchCode;
        Contract."Agreed Daily Rate" := AgreedRate;
        Contract.Insert();
    end;

    local procedure AgreedRateHX133(ContractNo: Code[20]): Decimal
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        exit(Contract."Agreed Daily Rate");
    end;

    local procedure CountMessagesHX133(EventType: Text[50]; VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Event Type", EventType);
        Entry.SetRange("Vehicle No.", VehicleNo);
        exit(Entry.Count());
    end;

    local procedure CountPayloadHX133(EventType: Text[50]; VehicleNo: Code[20]; Payload: Text[2048]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Event Type", EventType);
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.SetRange(Payload, Payload);
        exit(Entry.Count());
    end;

    local procedure CountRatesChangedHX133(BranchCode: Code[10]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Event Type", 'ratesChanged');
        Entry.SetRange(Payload, BranchCode);
        exit(Entry.Count());
    end;
}
