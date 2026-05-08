table 69300 "CG H030 Composite"
{
    Caption = 'CG H030 Composite';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Region Code"; Code[10])
        {
            Caption = 'Region Code';
            NotBlank = true;
        }
        field(2; "Customer No."; Code[20])
        {
            Caption = 'Customer No.';
            NotBlank = true;
        }
        field(10; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(20; "Description"; Text[100])
        {
            Caption = 'Description';
        }
    }

    keys
    {
        key(PK; "Region Code", "Customer No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
