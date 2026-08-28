codeunit 70831 "CG X123 Project Hours"
{
    procedure TotalHoursBilled(ProjectCode: Code[20]): Decimal
    var
        LaborEntry: Record "CG X123 Labor Entry";
    begin
        LaborEntry.SetRange("Project Code", ProjectCode);
        LaborEntry.CalcSums(Hours);
        exit(LaborEntry.Hours);
    end;
}
