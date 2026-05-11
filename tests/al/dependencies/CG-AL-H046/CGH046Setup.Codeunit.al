codeunit 69461 "CG H046 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        Item: Record "CG H046 Sample Item";
    begin
        if Item.Count > 0 then
            exit;

        InsertOne('I1', 'Alpha');
        InsertOne('I2', 'Beta');
        InsertOne('I3', 'Gamma');
    end;

    local procedure InsertOne(NoVal: Code[20]; DescVal: Text[50])
    var
        Item: Record "CG H046 Sample Item";
    begin
        Item.Init();
        Item."No." := NoVal;
        Item.Description := DescVal;
        Item.Insert();
    end;
}
