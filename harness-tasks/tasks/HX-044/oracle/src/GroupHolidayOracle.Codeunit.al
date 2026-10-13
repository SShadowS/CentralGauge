codeunit 86340 "HX044 Group Holiday Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure HolidayEnteredHereApplies()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX44();
        AddHX44HolidayHere(20270607D);

        Assert.IsFalse(WorkingDays.IsWorkingDay(20270607D), 'A group holiday entered in our company is not a working day here');
        Assert.IsTrue(WorkingDays.IsWorkingDay(20270608D), 'The day after the group holiday is a working day');
    end;

    [Test]
    procedure HolidayEnteredInSisterApplies()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX44();
        AddHX44HolidayInSister(20270608D);

        Assert.IsFalse(WorkingDays.IsWorkingDay(20270608D), 'A group holiday entered in the sister company is not a working day here');
    end;

    [Test]
    procedure HolidaySharedWithSister()
    var
        SisterHoliday: Record "CGR Group Holiday";
    begin
        InitHX44();
        AddHX44HolidayHere(20270609D);

        SisterHoliday.ChangeCompany(HX44SisterCompany());
        Assert.IsTrue(SisterHoliday.Get(20270609D), 'A group holiday entered in our company is visible in the sister company');
    end;

    [Test]
    procedure SisterNonWorkingDayDoesNotApply()
    var
        SisterNonWorkingDay: Record "CGR Non-Working Day";
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX44();
        SisterNonWorkingDay.ChangeCompany(HX44SisterCompany());
        SisterNonWorkingDay.Init();
        SisterNonWorkingDay."Non-Working Date" := 20270610D;
        SisterNonWorkingDay.Description := 'HX044 sister day';
        SisterNonWorkingDay.Insert();

        Assert.IsTrue(WorkingDays.IsWorkingDay(20270610D), 'A non-working day of the sister company does not apply in our company');
    end;

    [Test]
    procedure OwnNonWorkingDayStillApplies()
    var
        NonWorkingDay: Record "CGR Non-Working Day";
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX44();
        NonWorkingDay.Init();
        NonWorkingDay."Non-Working Date" := 20270611D;
        NonWorkingDay.Description := 'HX044 own day';
        NonWorkingDay.Insert();

        Assert.IsFalse(WorkingDays.IsWorkingDay(20270611D), 'Our own non-working day is still not a working day');
    end;

    [Test]
    procedure RemovedInSisterNoLongerApplies()
    var
        SisterHoliday: Record "CGR Group Holiday";
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX44();
        AddHX44HolidayHere(20270614D);
        Assert.IsFalse(WorkingDays.IsWorkingDay(20270614D), 'Precondition: the group holiday applies before it is deleted');

        SisterHoliday.ChangeCompany(HX44SisterCompany());
        if SisterHoliday.Get(20270614D) then
            SisterHoliday.Delete();

        Assert.IsTrue(WorkingDays.IsWorkingDay(20270614D), 'A group holiday deleted in the sister company no longer applies in our company');
    end;

    [Test]
    procedure WorkingDaysBetweenSkipsGroupHoliday()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX44();
        AddHX44HolidayInSister(20270609D);

        Assert.AreEqual(4, WorkingDays.WorkingDaysBetween(20270607D, 20270611D), 'Monday to Friday minus the group holiday on Wednesday');
    end;

    [Test]
    procedure NextWorkingDaySkipsGroupHoliday()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX44();
        AddHX44HolidayInSister(20270614D);

        Assert.AreEqual(20270615D, WorkingDays.NextWorkingDay(20270611D), 'Friday is followed by Tuesday when Monday is a group holiday');
    end;

    [Test]
    procedure LeaseInvoiceDateSkipsGroupHoliday()
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitHX44();
        AddHX44HolidayInSister(20270614D);

        Assert.AreEqual(20270615D, LeaseInvoicing.InvoiceDate(20270614D), 'A lease due on a group holiday is invoiced on the next working day');
    end;

    [Test]
    procedure GroupHolidayTableAsSpecified()
    var
        AllObj: Record AllObj;
        GroupHoliday: Record "CGR Group Holiday";
    begin
        InitHX44();
        AllObj.SetRange("Object Type", AllObj."Object Type"::Table);
        AllObj.SetRange("Object Name", 'CGR Group Holiday');
        Assert.IsTrue(AllObj.FindFirst(), 'The table CGR Group Holiday exists');
        Assert.AreEqual(70014, AllObj."Object ID", 'CGR Group Holiday has id 70014');
        Assert.AreEqual(100, MaxStrLen(GroupHoliday.Description), 'Description is Text[100]');
    end;

    local procedure InitHX44()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270607D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        ClearHX44Window(CopyStr(CompanyName(), 1, 30));
        ClearHX44Window(HX44SisterCompany());
    end;

    local procedure ClearHX44Window(InCompany: Text[30])
    var
        GroupHoliday: Record "CGR Group Holiday";
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        GroupHoliday.ChangeCompany(InCompany);
        GroupHoliday.SetRange("Holiday Date", 20270601D, 20270630D);
        GroupHoliday.DeleteAll();
        NonWorkingDay.ChangeCompany(InCompany);
        NonWorkingDay.SetRange("Non-Working Date", 20270601D, 20270630D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure AddHX44HolidayHere(HolidayDate: Date)
    var
        GroupHoliday: Record "CGR Group Holiday";
    begin
        GroupHoliday.Init();
        GroupHoliday."Holiday Date" := HolidayDate;
        GroupHoliday.Description := 'HX044 holiday here';
        GroupHoliday.Insert(true);
    end;

    local procedure AddHX44HolidayInSister(HolidayDate: Date)
    var
        GroupHoliday: Record "CGR Group Holiday";
    begin
        GroupHoliday.ChangeCompany(HX44SisterCompany());
        GroupHoliday.Init();
        GroupHoliday."Holiday Date" := HolidayDate;
        GroupHoliday.Description := 'HX044 holiday in sister';
        GroupHoliday.Insert();
    end;

    local procedure HX44SisterCompany(): Text[30]
    var
        Company: Record Company;
    begin
        if Company.FindSet() then
            repeat
                if Company.Name <> CompanyName() then
                    exit(Company.Name);
            until Company.Next() = 0;
        Error('HX044 needs a second company next to %1.', CompanyName());
    end;
}
