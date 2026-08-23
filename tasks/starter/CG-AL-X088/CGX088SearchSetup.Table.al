table 70531 "CG X088 Search Setup"
{
    Caption = 'Search Setup';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10])
        {
            Caption = 'Primary Key';
        }
        field(2; "Advanced Filtering Enabled"; Boolean)
        {
            Caption = 'Advanced Filtering Enabled';
        }
    }

    keys
    {
        key(PK; "Primary Key")
        {
            Clustered = true;
        }
    }

    procedure GetSetup(var SearchSetup: Record "CG X088 Search Setup")
    begin
        if not SearchSetup.Get() then begin
            SearchSetup.Init();
            SearchSetup.Insert();
        end;
    end;
}
