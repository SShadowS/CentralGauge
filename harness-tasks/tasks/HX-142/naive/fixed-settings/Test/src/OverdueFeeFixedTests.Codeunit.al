codeunit 80505 "CGR Overdue Fee Fixed Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ChargesThreeDays()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare();
        ContractNo := CheckedOutContract('HX142-NB1', 20250310D);
        Commit();
        Assert.AreEqual(1, FeeRun.ChargeOverdueFees(20250313D), 'One contract charged');
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindFirst();
        Assert.AreEqual(3, Fee.Days, 'Three days');
        Assert.AreEqual(30, Fee.Amount, 'Amount');
    end;

    [Test]
    procedure SecondNightOneDay()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare();
        ContractNo := CheckedOutContract('HX142-NB2', 20250310D);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        FeeRun.ChargeOverdueFees(20250314D);
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindLast();
        Assert.AreEqual(1, Fee.Days, 'One day on the second night');
    end;

    [Test]
    procedure RefusedContractKeepsNothing()
    var
        Contract: Record "CGR Rental Contract";
        Fee: Record "CGR Overdue Fee Entry";
        Spy: Codeunit "CGR Overdue Fee Fixed Spy";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        RefusedNo: Code[20];
        OtherNo: Code[20];
        Charged: Integer;
    begin
        Prepare();
        RefusedNo := CheckedOutContract('HX142-NB3', 20250310D);
        OtherNo := CheckedOutContract('HX142-NB4', 20250310D);
        Spy.RefuseContract(RefusedNo);
        BindSubscription(Spy);
        Commit();
        Charged := FeeRun.ChargeOverdueFees(20250313D);
        UnbindSubscription(Spy);
        Assert.AreEqual(1, Charged, 'Only the other contract is charged');
        Fee.SetRange("Contract No.", RefusedNo);
        Assert.AreEqual(0, Fee.Count(), 'No entry for the refused contract');
        Contract.Get(RefusedNo);
        Assert.AreEqual(0D, Contract."Fees Charged Through", 'Refused contract unchanged');
        Fee.SetRange("Contract No.", OtherNo);
        Assert.AreEqual(1, Fee.Count(), 'The other contract is charged');
    end;

    [Test]
    procedure RefusedDaysChargedNextNight()
    var
        Fee: Record "CGR Overdue Fee Entry";
        Spy: Codeunit "CGR Overdue Fee Fixed Spy";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare();
        ContractNo := CheckedOutContract('HX142-NB5', 20250310D);
        Spy.RefuseContract(ContractNo);
        BindSubscription(Spy);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        UnbindSubscription(Spy);
        Commit();
        FeeRun.ChargeOverdueFees(20250314D);
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindFirst();
        Assert.AreEqual(4, Fee.Days, 'Refused days are charged the next night');
    end;

    local procedure Prepare()
    var
        Contract: Record "CGR Rental Contract";
        Setup: Record "CGR Setup";
        Settings: Codeunit "CGR Overdue Fee Settings";
    begin
        WorkDate(20250313D);
        Contract.SetRange(Status, Contract.Status::"Checked Out");
        Contract.DeleteAll();
        Setup.GetOrCreate();
        Setup."Overdue Fee per Day" := 10;
        Setup."Overdue Grace Days" := 0;
        Setup.Modify();
        Settings.Reload();
    end;

    local procedure CheckedOutContract(VehicleNo: Code[20]; EndDate: Date): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX142 Naive', EndDate - 3, EndDate);
        RentalMgt.CheckOut(ContractNo);
        exit(ContractNo);
    end;
}
