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
        Assert.AreEqual(4, ExposureLine."Open Leases", 'The other company has four open leases in its own data: A, B, C and D (D is below 0)');
        Assert.AreEqual(305, ExposureLine."Open Balance", 'The other company''s open balance comes from its own schedule lines: 300 + 25 + 40 - 60');
        ExposureLine.SetRange("Company Name", CopyStr(CompanyName(), 1, 30));
        Assert.IsTrue(ExposureLine.FindFirst(), 'GroupExposure has a line named after our own company');
        Assert.AreEqual(2, ExposureLine."Open Leases", 'Our company has two open leases: A and E (E is below 0); B is fully invoiced');
        Assert.AreEqual(120, ExposureLine."Open Balance", 'Our open balance comes from our own schedule lines: 100 + 50 - 30');
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
        Assert.AreEqual(2, ExposureLine."Open Leases", 'Our company has two open leases: A and E (E is below 0)');
        Assert.AreEqual(120, ExposureLine."Open Balance", 'Our open balance is 100 + 50 - 30');
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
        Assert.AreEqual(7, Spy.SeenCountHX169(), 'CGR Lease Balance raises OnAfterOpenLeaseBalance once for every lease GroupExposure reads, in every company. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-E=-30'), 'Our credit lease E is raised with our balance. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-D=-60'), 'The other company''s credit lease D is raised with its own balance. Seen: ' + Spy.SeenTextHX169());
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
        Assert.AreEqual(3, Spy.SeenCountHX169(), 'CompanyExposure raises OnAfterOpenLeaseBalance once for each of our leases. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-E=-30'), 'Our credit lease E is raised with our balance. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-A=150'), 'Our lease A is raised with our balance. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-B=0'), 'Our fully invoiced lease B is raised with 0. Seen: ' + Spy.SeenTextHX169());
    end;

    [Test]
    procedure LeaseBalanceUnchanged()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseBalance: Codeunit "CGR Lease Balance";
        Spy: Codeunit "HX169 Lease Balance Spy";
        Other: Text[30];
    begin
        Other := ArrangeHX169();
        BindSubscription(Spy);

        Assert.AreEqual(150, LeaseBalance.OpenLeaseBalance('HX169-A'), 'OpenLeaseBalance gives our lease A''s open balance');
        Assert.AreEqual(0, LeaseBalance.OpenLeaseBalance('HX169-B'), 'OpenLeaseBalance gives 0 for our fully invoiced lease B');
        Assert.AreEqual(-30, LeaseBalance.OpenLeaseBalance('HX169-E'), 'OpenLeaseBalance gives a balance below 0 for our credit lease E');
        ScheduleLine.ChangeCompany(Other);
        Assert.AreEqual(300, LeaseBalance.OpenLeaseBalanceFrom(ScheduleLine, 'HX169-A'), 'OpenLeaseBalanceFrom sums the schedule lines it is given: the other company''s lease A');
        Assert.AreEqual(-60, LeaseBalance.OpenLeaseBalanceFrom(ScheduleLine, 'HX169-D'), 'OpenLeaseBalanceFrom gives a balance below 0 for the other company''s credit lease D');

        UnbindSubscription(Spy);
        Assert.AreEqual(5, Spy.SeenCountHX169(), 'Each call raises OnAfterOpenLeaseBalance once. Seen: ' + Spy.SeenTextHX169());
        Assert.IsTrue(Spy.SawHX169('HX169-D=-60'), 'The event carries the balance below 0. Seen: ' + Spy.SeenTextHX169());
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

        // Our company: A open 100 + 50 (70 invoiced), B fully invoiced, E open -30 (a credit, only here).
        InsertContractHX169('', 'HX169-A');
        InsertLineHX169('', 'HX169-A', 10000, 100, false);
        InsertLineHX169('', 'HX169-A', 20000, 50, false);
        InsertLineHX169('', 'HX169-A', 30000, 70, true);
        InsertContractHX169('', 'HX169-B');
        InsertLineHX169('', 'HX169-B', 10000, 80, true);
        InsertContractHX169('', 'HX169-E');
        InsertLineHX169('', 'HX169-E', 10000, -30, false);

        // Other company: A open 300 (90 invoiced), B open 25, C open 40, D open -60 (a credit; C and D exist only there).
        InsertContractHX169(Other, 'HX169-A');
        InsertLineHX169(Other, 'HX169-A', 10000, 300, false);
        InsertLineHX169(Other, 'HX169-A', 20000, 90, true);
        InsertContractHX169(Other, 'HX169-B');
        InsertLineHX169(Other, 'HX169-B', 10000, 25, false);
        InsertContractHX169(Other, 'HX169-C');
        InsertLineHX169(Other, 'HX169-C', 10000, 40, false);
        InsertContractHX169(Other, 'HX169-D');
        InsertLineHX169(Other, 'HX169-D', 10000, 20, true);
        InsertLineHX169(Other, 'HX169-D', 20000, -60, false);
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
