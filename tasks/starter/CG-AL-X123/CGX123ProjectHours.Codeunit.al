codeunit 70831 "CG X123 Project Hours"
{
    procedure TotalHoursBilled(ProjectCode: Code[20]): Decimal
    var
        LaborEntry: Record "CG X123 Labor Entry";
        Total: Decimal;
    begin
        LaborEntry.SetRange("Project Code", ProjectCode);
        if LaborEntry.FindSet() then
            repeat
                Total += LaborEntry.Hours;
            until LaborEntry.Next() = 0;
        exit(Total);
    end;
}
