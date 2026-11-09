codeunit 80618 "CGR Hourly Direct Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure StartedHourCharged()
    var
        Bill: Record "CGR Hourly Bill";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
    begin
        ContractNo := DirectContract('HX154-NC1', 10, 090000T, 115900T);
        Commit();
        Assert.IsTrue(HourlyBilling.BillHourly(ContractNo), 'Billed');
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Bill.Count(), 'One row');
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, 'Three hours');
        Assert.AreEqual(30, Bill.Amount, 'Amount');
    end;

    [Test]
    procedure ExactHoursKept()
    var
        Bill: Record "CGR Hourly Bill";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
    begin
        ContractNo := DirectContract('HX154-NC2', 10, 090000T, 110000T);
        Commit();
        Assert.IsTrue(HourlyBilling.BillHourly(ContractNo), 'Billed');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(2, Bill.Hours, 'Two hours');
    end;

    [Test]
    procedure OneSecondMore()
    var
        Bill: Record "CGR Hourly Bill";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
    begin
        ContractNo := DirectContract('HX154-NC3', 10, 090000T, 110001T);
        Commit();
        Assert.IsTrue(HourlyBilling.BillHourly(ContractNo), 'Billed');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, 'Three hours');
    end;

    [Test]
    procedure LoyaltyDiscountDeducted()
    var
        Bill: Record "CGR Hourly Bill";
        Spy: Codeunit "CGR Hourly Direct Spy";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
        Billed: Boolean;
    begin
        ContractNo := DirectContract('HX154-NC4', 10, 090000T, 120000T);
        Spy.SetDirectDiscount(20);
        BindSubscription(Spy);
        Commit();
        Billed := HourlyBilling.BillHourly(ContractNo);
        UnbindSubscription(Spy);
        Assert.IsTrue(Billed, 'Billed');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(24, Bill.Amount, '3 x 10 less 20 %');
    end;

    [Test]
    procedure PaymentRefusal()
    var
        Bill: Record "CGR Hourly Bill";
        Spy: Codeunit "CGR Hourly Direct Spy";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
        Billed: Boolean;
    begin
        ContractNo := DirectContract('HX154-NC5', 10, 090000T, 110000T);
        Spy.SetDirectRefusal(ContractNo);
        BindSubscription(Spy);
        Commit();
        Billed := HourlyBilling.BillHourly(ContractNo);
        UnbindSubscription(Spy);
        Assert.IsFalse(Billed, 'Refused');
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Bill.Count(), 'No row');
    end;

    local procedure DirectContract(VehicleNo: Code[20]; HourlyRate: Decimal; PickedUpTime: Time; ReturnedTime: Time): Code[20]
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Bill: Record "CGR Hourly Bill";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get(VehicleNo);
        Vehicle."Hourly Rate" := HourlyRate;
        Vehicle.Modify();
        ContractNo := Lib.CreateContract(VehicleNo);
        Contract.Get(ContractNo);
        Contract."Picked Up At" := CreateDateTime(20270301D, PickedUpTime);
        Contract."Returned At" := CreateDateTime(20270301D, ReturnedTime);
        Contract.Modify();
        Bill.SetRange("Contract No.", ContractNo);
        Bill.DeleteAll();
        exit(ContractNo);
    end;
}
