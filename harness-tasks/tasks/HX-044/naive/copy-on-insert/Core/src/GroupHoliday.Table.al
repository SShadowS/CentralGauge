table 70014 "CGR Group Holiday"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Holiday Date"; Date) { }
        field(2; Description; Text[100]) { }
    }

    keys
    {
        key(PK; "Holiday Date") { Clustered = true; }
    }

    trigger OnInsert()
    var
        Company: Record Company;
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        if Company.FindSet() then
            repeat
                NonWorkingDay.ChangeCompany(Company.Name);
                if not NonWorkingDay.Get("Holiday Date") then begin
                    NonWorkingDay.Init();
                    NonWorkingDay."Non-Working Date" := "Holiday Date";
                    NonWorkingDay.Description := Description;
                    NonWorkingDay.Insert();
                end;
            until Company.Next() = 0;
    end;
}
