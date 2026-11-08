codeunit 80500 "CGR Overdue Fee Run Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure FirstNightChargesTheDaysAfterTheEndDate()
    var
        Contract: Record "CGR Rental Contract";
        Fee: Record "CGR Overdue Fee Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Runner: Codeunit "CGR Overdue Fee Run Runner";
        OverdueNo: Code[20];
        EndsOnAsOfNo: Code[20];
        OpenNo: Code[20];
        Ok: Boolean;
    begin
        HX142Prepare(10, 0);
        OverdueNo := HX142CheckedOutContract('HX142-A1', 20250310D);
        EndsOnAsOfNo := HX142CheckedOutContract('HX142-A2', 20250313D);
        Lib.CreateVehicle('HX142-A3', 1000, Enum::"CGR Maintenance Strategy"::Default);
        OpenNo := RentalMgt.CreateContract('HX142-A3', 'HX142 Customer', 20250307D, 20250310D);
        Runner.SetRunAsOf(20250313D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The overdue fee run finishes: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ContractsCharged(), 'One contract is charged');
        Fee.SetRange("Contract No.", OverdueNo);
        Assert.AreEqual(1, Fee.Count(), 'One fee entry for the overdue contract');
        Fee.FindFirst();
        Assert.AreEqual(3, Fee.Days, 'End Date 2025-03-10, AsOf 2025-03-13: 3 days');
        Assert.AreEqual(30, Fee.Amount, 'Amount is days x fee per day');
        Contract.Get(OverdueNo);
        Assert.AreEqual(20250313D, Contract."Fees Charged Through", 'Fees Charged Through is AsOf');
        Fee.SetFilter("Contract No.", '%1|%2', EndsOnAsOfNo, OpenNo);
        Assert.AreEqual(0, Fee.Count(), 'A contract ending on AsOf and an open contract are not charged');
    end;

    [Test]
    procedure SecondNightChargesOnlyTheNewDay()
    var
        Contract: Record "CGR Rental Contract";
        Fee: Record "CGR Overdue Fee Entry";
        Runner: Codeunit "CGR Overdue Fee Run Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX142Prepare(10, 0);
        ContractNo := HX142CheckedOutContract('HX142-B1', 20250310D);
        Runner.SetRunAsOf(20250313D);
        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The first night finishes: ' + GetLastErrorText());

        Runner.SetRunAsOf(20250314D);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The second night finishes: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ContractsCharged(), 'The contract is charged again on the second night');
        Fee.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(2, Fee.Count(), 'One fee entry per night');
        Fee.FindLast();
        Assert.AreEqual(1, Fee.Days, 'The second night charges 1 day');
        Assert.AreEqual(10, Fee.Amount, 'The second night charges 1 x fee per day');
        Contract.Get(ContractNo);
        Assert.AreEqual(20250314D, Contract."Fees Charged Through", 'Fees Charged Through moves to the second AsOf');
    end;

    [Test]
    procedure GraceDaysAreNotCharged()
    var
        Contract: Record "CGR Rental Contract";
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        GraceNo: Code[20];
        InGraceNo: Code[20];
        Charged: Integer;
    begin
        HX142Prepare(5, 2);
        GraceNo := HX142CheckedOutContract('HX142-C1', 20250310D);
        InGraceNo := HX142CheckedOutContract('HX142-C2', 20250311D);

        Commit();
        Charged := FeeRun.ChargeOverdueFees(20250313D);

        Assert.AreEqual(1, Charged, 'Only the contract past its grace days is charged');
        Fee.SetRange("Contract No.", GraceNo);
        Assert.AreEqual(1, Fee.Count(), 'One fee entry after the grace days');
        Fee.FindFirst();
        Assert.AreEqual(1, Fee.Days, 'End 2025-03-10 + 2 grace days, AsOf 2025-03-13: 1 day');
        Assert.AreEqual(5, Fee.Amount, 'Amount is 1 x fee per day');
        Fee.SetRange("Contract No.", InGraceNo);
        Assert.AreEqual(0, Fee.Count(), 'A contract still within its grace days is skipped');
        Contract.Get(InGraceNo);
        Assert.AreEqual(0D, Contract."Fees Charged Through", 'A skipped contract is not changed');
    end;

    [Test]
    procedure RefusedContractKeepsNothingAndOthersAreCharged()
    var
        Contract: Record "CGR Rental Contract";
        Fee: Record "CGR Overdue Fee Entry";
        Spy: Codeunit "CGR Overdue Fee Refusal Spy";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        RefusedNo: Code[20];
        ChargedNo: Code[20];
        Charged: Integer;
    begin
        HX142Prepare(10, 0);
        RefusedNo := HX142CheckedOutContract('HX142-D1', 20250310D);
        ChargedNo := HX142CheckedOutContract('HX142-D2', 20250310D);
        Spy.RefuseOverdueFee(RefusedNo);
        BindSubscription(Spy);

        Commit();
        Charged := FeeRun.ChargeOverdueFees(20250313D);
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Charged, 'The result counts the charged contracts only');
        Fee.SetRange("Contract No.", RefusedNo);
        Assert.AreEqual(0, Fee.Count(), 'The refused contract gets no fee entry');
        Contract.Get(RefusedNo);
        Assert.AreEqual(0D, Contract."Fees Charged Through", 'The refused contract keeps nothing of the attempt');
        Fee.SetRange("Contract No.", ChargedNo);
        Assert.AreEqual(1, Fee.Count(), 'The other contract is still charged');
        Fee.FindFirst();
        Assert.AreEqual(3, Fee.Days, 'The other contract is charged 3 days');
        Contract.Get(ChargedNo);
        Assert.AreEqual(20250313D, Contract."Fees Charged Through", 'The other contract is charged through AsOf');
    end;

    [Test]
    procedure RefusedDaysAreChargedOnALaterNight()
    var
        Contract: Record "CGR Rental Contract";
        Fee: Record "CGR Overdue Fee Entry";
        Spy: Codeunit "CGR Overdue Fee Refusal Spy";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
        Charged: Integer;
    begin
        HX142Prepare(10, 0);
        ContractNo := HX142CheckedOutContract('HX142-E1', 20250310D);
        Spy.RefuseOverdueFee(ContractNo);
        BindSubscription(Spy);
        Commit();
        Charged := FeeRun.ChargeOverdueFees(20250313D);
        Assert.AreEqual(0, Charged, 'The refused night charges nothing');

        Spy.RefuseOverdueFee('');
        Commit();
        Charged := FeeRun.ChargeOverdueFees(20250314D);
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Charged, 'The next night charges the contract');
        Fee.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Fee.Count(), 'One fee entry, from the later night');
        Fee.FindFirst();
        Assert.AreEqual(4, Fee.Days, 'The later night also charges the refused days: 2025-03-10 to 2025-03-14');
        Assert.AreEqual(40, Fee.Amount, 'Amount covers the refused days too');
        Contract.Get(ContractNo);
        Assert.AreEqual(20250314D, Contract."Fees Charged Through", 'Charged through the later AsOf');
    end;

    [Test]
    procedure SettingsChangeTakesEffectAfterReload()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        HX142Prepare(3, 0);
        ContractNo := HX142CheckedOutContract('HX142-F1', 20250310D);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindLast();
        Assert.AreEqual(9, Fee.Amount, 'First night: 3 days x 3');

        HX142WriteFeeSettings(7.25, 0);
        Commit();
        FeeRun.ChargeOverdueFees(20250314D);

        Assert.AreEqual(2, Fee.Count(), 'One fee entry per night');
        Fee.FindLast();
        Assert.AreEqual(1, Fee.Days, 'Second night: 1 day');
        Assert.AreEqual(7.25, Fee.Amount, 'The new fee per day applies after Reload');
    end;

    local procedure HX142Prepare(FeePerDay: Decimal; GraceDays: Integer)
    var
        Contract: Record "CGR Rental Contract";
        Fee: Record "CGR Overdue Fee Entry";
    begin
        WorkDate(20250313D);
        Contract.SetRange(Status, Contract.Status::"Checked Out");
        Contract.DeleteAll();
        Fee.DeleteAll();
        HX142WriteFeeSettings(FeePerDay, GraceDays);
    end;

    local procedure HX142WriteFeeSettings(FeePerDay: Decimal; GraceDays: Integer)
    var
        Setup: Record "CGR Setup";
        Settings: Codeunit "CGR Overdue Fee Settings";
    begin
        Setup.GetOrCreate();
        Setup."Overdue Fee per Day" := FeePerDay;
        Setup."Overdue Grace Days" := GraceDays;
        Setup.Modify();
        Settings.Reload();
    end;

    local procedure HX142CheckedOutContract(VehicleNo: Code[20]; EndDate: Date): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX142 Customer', EndDate - 3, EndDate);
        RentalMgt.CheckOut(ContractNo);
        exit(ContractNo);
    end;
}
