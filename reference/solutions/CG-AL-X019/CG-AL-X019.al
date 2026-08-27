codeunit 71080 "CG X019 Processor"
{
    Access = Internal;

    procedure RecalcAndGetAmount(RefID: Guid): Integer
    var
        CGX019Doc: Record "CG X019 Doc";
        CGX019Refresher: Codeunit "CG X019 Refresher";
        DocNotFoundErr: Label 'No CG X019 Doc record was found for Ref ID %1.', Comment = '%1 = Ref ID';
    begin
        CGX019Doc.SetRange("Ref ID", RefID);
        if not CGX019Doc.FindFirst() then
            Error(DocNotFoundErr, RefID);

        CGX019Refresher.Recalc(RefID);

        if not CGX019Doc.FindFirst() then
            Error(DocNotFoundErr, RefID);

        exit(CGX019Doc.Amount);
    end;
}