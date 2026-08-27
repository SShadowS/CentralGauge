codeunit 71150 "CG X026 Filter"
{
    Access = Internal;

    procedure SumByCategory(CategoryFilter: Code[20]): Integer
    var
        CGX026Item: Record "CG X026 Item";
    begin
        if CategoryFilter <> '' then
            CGX026Item.SetRange(Category, CategoryFilter);
        CGX026Item.CalcSums(Amount);
        exit(CGX026Item.Amount);
    end;
}