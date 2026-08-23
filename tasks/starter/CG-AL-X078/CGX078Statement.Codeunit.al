codeunit 70432 "CG X078 Statement"
{
    var
        UnknownCategoryErr: Label 'Royalty category %1 is not supported.', Comment = '%1 = the category code from the performance';

    procedure LineAmount(Category: Code[20]; Audience: Integer): Decimal
    begin
        case Category of
            'TRAGEDY':
                begin
                    if Audience > 30 then
                        exit(400 + 10 * (Audience - 30));
                    exit(400);
                end;
            'COMEDY':
                begin
                    if Audience > 20 then
                        exit(300 + 3 * Audience + 100 + 5 * (Audience - 20));
                    exit(300 + 3 * Audience);
                end;
            else
                Error(UnknownCategoryErr, Category);
        end;
    end;

    procedure LineCredits(Category: Code[20]; Audience: Integer): Integer
    var
        Credits: Integer;
    begin
        if not (Category in ['TRAGEDY', 'COMEDY']) then
            Error(UnknownCategoryErr, Category);
        if Audience > 30 then
            Credits := Audience - 30;
        if Category = 'COMEDY' then
            Credits += Audience div 5;
        exit(Credits);
    end;

    procedure BuildStatement(AgreementNo: Code[20]; var StatementLine: Record "CG X078 Statement Line" temporary; var TotalAmount: Decimal; var TotalCredits: Integer)
    var
        Performance: Record "CG X078 Performance";
        LineNo: Integer;
    begin
        StatementLine.Reset();
        StatementLine.DeleteAll();

        Performance.SetRange("Agreement No.", AgreementNo);
        if not Performance.FindSet() then
            exit;
        repeat
            LineNo += 1;
            StatementLine.Init();
            StatementLine."Line No." := LineNo;
            StatementLine."Play Name" := Performance."Play Name";
            StatementLine.Category := Performance.Category;
            StatementLine.Audience := Performance.Audience;
            StatementLine.Amount := LineAmount(Performance.Category, Performance.Audience);
            StatementLine.Credits := LineCredits(Performance.Category, Performance.Audience);
            StatementLine.Insert();
            TotalAmount += StatementLine.Amount;
            TotalCredits += StatementLine.Credits;
        until Performance.Next() = 0;
    end;
}
