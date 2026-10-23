codeunit 70326 "CGR Schedule Import"
{
    var
        InvoicedErr: Label 'Lease %1 has invoiced schedule lines and cannot be rescheduled.', Comment = '%1 = lease number';
        EmptyErr: Label 'The import for lease %1 has no lines.', Comment = '%1 = lease number';
        NoDueDateErr: Label 'Line %1 of the import has no due date.', Comment = '%1 = import line number';
        BeforeStartErr: Label 'Line %1 is due before lease %2 starts.', Comment = '%1 = import line number, %2 = lease number';
        RepeatErr: Label 'Line %1 repeats the due date %2 of line %3.', Comment = '%1 = import line number, %2 = due date, %3 = earlier import line number';

    procedure ImportSchedule(ContractNo: Code[20]; var ImportLine: Record "CGR Schedule Import Line"): Integer
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Line: Record "CGR Schedule Import Line";
        LineNo: Integer;
    begin
        Contract.Get(ContractNo);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, true);
        if not ScheduleLine.IsEmpty() then
            Error(InvoicedErr, ContractNo);

        Line.Copy(ImportLine, true);
        Line.Reset();
        if Line.IsEmpty() then
            Error(EmptyErr, ContractNo);

        Line.FindSet();
        repeat
            if Line."Due Date" = 0D then
                Error(NoDueDateErr, Line."Line No.");
            if Line."Due Date" < Contract."Start Date" then
                Error(BeforeStartErr, Line."Line No.", ContractNo);
            ImportLine.Reset();
            ImportLine.SetRange("Due Date", Line."Due Date");
            ImportLine.SetFilter("Line No.", '<%1', Line."Line No.");
            if ImportLine.FindFirst() then
                Error(RepeatErr, Line."Line No.", Format(Line."Due Date", 0, 9), ImportLine."Line No.");
            ImportLine.Reset();
        until Line.Next() = 0;

        ScheduleLine.SetRange(Invoiced);
        ScheduleLine.DeleteAll(true);
        Line.FindSet();
        repeat
            LineNo += 10000;
            ScheduleLine.Init();
            ScheduleLine."Contract No." := ContractNo;
            ScheduleLine."Line No." := LineNo;
            ScheduleLine."Due Date" := Line."Due Date";
            ScheduleLine.Amount := Line.Amount;
            ScheduleLine.Insert(true);
        until Line.Next() = 0;

        Contract.Months := Line.Count();
        Contract.Modify(true);
        exit(Contract.Months);
    end;
}
