table 69050 "CG Cust Prereq Table"
{
    Caption = 'CG Cust Prereq Table';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            NotBlank = true;
        }
        field(10; "Visible Field"; Text[50])
        {
            Caption = 'Visible Field';
        }
        field(20; "Hidden Field"; Text[50])
        {
            Caption = 'Hidden Field';
            AllowInCustomizations = AsReadWrite;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
