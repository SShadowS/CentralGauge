codeunit 70950 "CG X006 Selector"
{
    Access = Internal;

    procedure CollectRelevant(var Result: Record "CG X006 Doc" temporary): Integer
    var
        Doc: Record "CG X006 Doc";
        Customer: Record "CG X006 Customer";
        Count: Integer;
    begin
        Result.Reset();
        Result.DeleteAll();
        Count := 0;

        if Doc.FindSet() then
            repeat
                if Doc.Status = Doc.Status::Open then begin
                    Result := Doc;
                    Result.Insert();
                    Count += 1;
                end else
                    if Customer.Get(Doc."Customer No.") and Customer.Blocked then begin
                        Result := Doc;
                        Result.Insert();
                        Count += 1;
                    end;
            until Doc.Next() = 0;

        exit(Count);
    end;
}