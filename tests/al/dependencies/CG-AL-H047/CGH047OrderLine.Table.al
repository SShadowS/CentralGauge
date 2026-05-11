table 69470 "CG H047 Order Line"
{
    Caption = 'CG H047 Order Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(10; "Customer No."; Code[20])
        {
            Caption = 'Customer No.';
        }
    }

    keys
    {
        key(PK; "Line No.")
        {
            Clustered = true;
        }
    }
}
