codeunit 70940 "CG X005 Flagger"
{
    Access = Internal;

    procedure FlagHighValues(Threshold: Integer): Integer
    var
        CGX005Item: Record "CG X005 Item";
        FlaggedCount: Integer;
    begin
        FlaggedCount := 0;
        CGX005Item.SetFilter("Value", '>%1', Threshold);
        if CGX005Item.FindSet(true) then
            repeat
                CGX005Item."Flag" := true;
                CGX005Item.Modify();
                FlaggedCount += 1;
            until CGX005Item.Next() = 0;
        exit(FlaggedCount);
    end;
}