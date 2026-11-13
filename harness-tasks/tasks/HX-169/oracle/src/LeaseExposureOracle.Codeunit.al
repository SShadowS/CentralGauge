codeunit 88495 "HX169 Lease Exposure Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure GroupLinesUseEachCompanysLeases()
    var
        Company: Record Company;
        ExposureLine: Record "CGR Lease Exposure Line" temporary;
        LeaseExposure: Codeunit "CGR Lease Exposure";
        Other: Text[30];
    begin
        Other := ArrangeHX169();

        LeaseExposure.GroupExposure(ExposureLine);

        Assert.AreEqual(Company.Count(), ExposureLine.Count(), 'GroupExposure gives one line for every company in the database');
        ExposureLine.SetRange("Company Name", Other);
        Assert.IsTrue(ExposureLine.FindFirst(), 'GroupExposure has a line named after the other company');
        Assert.AreEqual(3, ExposureLine."Open Leases", 'The other company has three open leases in its own data: A, B and C');
        Assert.AreEqual(365, ExposureLine."Open Balance", 'The other company''s open balance comes from its own schedule lines: 300 + 25 + 40');
        ExposureLine.SetRange("Company Name", CopyStr(CompanyName(), 1, 30));
        Assert.IsTrue(ExposureLine.FindFirst(), 'GroupExposure has a line named after our own company');
        Assert.AreEqual(1, ExposureLine."Open Leases", 'Our company has one open lease: A; B is fully invoiced');
        Assert.AreEqual(150, ExposureLine."Open Balance", 'Our open balance comes from our own schedule lines: 100 + 50');
    end;

    [Test]
    procedure CompanyLineUsesOwnLeases()
    var
        ExposureLine: Record "CGR Lease Exposure Line" temporary;
        LeaseExposure: Codeunit "CGR Lease Exposure";
    begin
        ArrangeHX169();

        LeaseExposure.CompanyExposure(ExposureLine);

        Assert.AreEqual(1, ExposureLine.Count(), 'CompanyExposure gives one line');
        Assert.IsTrue(ExposureLine.FindFirst(), 'CompanyExposure line exists');
        Assert.AreEqual(CompanyName(), ExposureLine."Company Name", 'CompanyExposure names our own company');
        Assert.AreEqual(1, ExposureLine."Open Leases", 'Our company has one open lease');
        Assert.AreEqual(150, ExposureLine."Open Balance", 'Our open balance is 100 + 50');
    end;

    [Test]
    procedure GroupRaisesBalanceForEveryLease()
    var
        ExposureLine: Record "CGR Lease Exposure Line" temporary;
        LeaseExposure: Codeunit "CGR Lease Exposure";
        Spy: Codeunit "HX169 Lease Balance Spy";
    begin
        ArrangeHX169();
        BindSubscription(Spy);

        LeaseExposure.GroupExposure(ExposureLine);

        UnbindSubscription(Spy);
        Assert.AreEqual(5, Spy.SeenCountHX169(), 'OnAfterOpenLeaseBalance is raised once for every lease GroupExposure reads, in every company. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-A=300'), 'The other company''s lease A is raised with its own balance. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-B=25'), 'The other company''s lease B is raised with its own balance. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-C=40'), 'The other company''s lease C is raised with its own balance. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-A=150'), 'Our lease A is raised with our balance. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-B=0'), 'Our fully invoiced lease B is raised with 0. Seen: ' + Spy.SeenTextHX169());
    end;

    [Test]
    procedure CompanyRaisesBalanceForEveryLease()
    var
        ExposureLine: Record "CGR Lease Exposure Line" temporary;
        LeaseExposure: Codeunit "CGR Lease Exposure";
        Spy: Codeunit "HX169 Lease Balance Spy";
    begin
        ArrangeHX169();
        BindSubscription(Spy);

        LeaseExposure.CompanyExposure(ExposureLine);

        UnbindSubscription(Spy);
        Assert.AreEqual(2, Spy.SeenCountHX169(), 'CompanyExposure raises OnAfterOpenLeaseBalance once for each of our leases. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-A=150'), 'Our lease A is raised with our balance. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-B=0'), 'Our fully invoiced lease B is raised with 0. Seen: ' + Spy.SeenTextHX169());
    end;

    local procedure ArrangeHX169() Other: Text[30]
    var
        Company: Record Company;
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        WorkDate(20270301D);
        Company.SetFilter(Name, '<>%1', CompanyName());
        Company.FindFirst();
        Other := Company.Name;

        Company.Reset();
        Company.FindSet();
        repeat
            ScheduleLine.ChangeCompany(Company.Name);
            Contract.ChangeCompany(Company.Name);
            ScheduleLine.DeleteAll();
            Contract.DeleteAll();
        until Company.Next() = 0;

        // Our company: A open 100 + 50 (70 invoiced), B fully invoiced.
        InsertContractHX169('', 'HX169-A');
        InsertLineHX169('', 'HX169-A', 10000, 100, false);
        InsertLineHX169('', 'HX169-A', 20000, 50, false);
        InsertLineHX169('', 'HX169-A', 30000, 70, true);
        InsertContractHX169('', 'HX169-B');
        InsertLineHX169('', 'HX169-B', 10000, 80, true);

        // Other company: A open 300 (90 invoiced), B open 25, C open 40 (C exists only there).
        InsertContractHX169(Other, 'HX169-A');
        InsertLineHX169(Other, 'HX169-A', 10000, 300, false);
        InsertLineHX169(Other, 'HX169-A', 20000, 90, true);
        InsertContractHX169(Other, 'HX169-B');
        InsertLineHX169(Other, 'HX169-B', 10000, 25, false);
        InsertContractHX169(Other, 'HX169-C');
        InsertLineHX169(Other, 'HX169-C', 10000, 40, false);
    end;

    local procedure InsertContractHX169(InCompany: Text[30]; ContractNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
    begin
        if InCompany <> '' then
            Contract.ChangeCompany(InCompany);
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := 'HX169-V';
        Contract."Customer Name" := 'HX169 Customer';
        Contract."Start Date" := 20270101D;
        Contract.Months := 3;
        Contract.Insert();
    end;

    local procedure InsertLineHX169(InCompany: Text[30]; ContractNo: Code[20]; LineNo: Integer; Amount: Decimal; IsInvoiced: Boolean)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        if InCompany <> '' then
            ScheduleLine.ChangeCompany(InCompany);
        ScheduleLine.Init();
        ScheduleLine."Contract No." := ContractNo;
        ScheduleLine."Line No." := LineNo;
        ScheduleLine."Due Date" := 20270101D;
        ScheduleLine.Amount := Amount;
        ScheduleLine.Invoiced := IsInvoiced;
        ScheduleLine.Insert();
    end;
}
